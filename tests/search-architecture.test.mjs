import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSearchResults } from '../src/lib/server/search/ranking.js';
import { createSearchService } from '../src/lib/server/search/service.js';
import { createRewideMachineClient } from '../src/lib/server/integrations/rewide-machine-client.js';
import { createHttpDiscoveryClient } from '../src/lib/server/integrations/http-discovery-client.js';
import { GET as legacySearch } from '../src/routes/api/search/+server.js';
import { GET as versionedSearch, OPTIONS as versionedOptions } from '../src/routes/api/v1/search/+server.js';
import { OPTIONS as legacyOptions } from '../src/routes/api/search/+server.js';

test('the unversioned search route is a compatibility alias for v1', () => {
  assert.equal(legacySearch, versionedSearch);
});

test('ranking merges sources, removes document duplicates, and returns the public result shape', () => {
  const results = rankSearchResults([
    {
      url: 'https://example.com/',
      canonicalUrl: 'https://publisher.example/story',
      canonicalStatus: 'cross-origin',
      title: 'Example',
      description: 'Example description',
      snippet: 'Example snippet',
      language: 'en',
      fetchedAt: '2026-11-15T00:00:00.000Z',
    },
  ], [
    {
      url: 'https://example.com/',
      title: 'Duplicate',
      indexStatus: 'indexable',
    },
    {
      url: 'https://other.example/',
      title: 'Other',
      indexStatus: 'unknown',
      sourceUrl: 'https://example.com/',
      discoveredAt: '2026-11-15T00:00:00.000Z',
    },
    {
      url: 'https://publisher.example/story',
      title: 'Syndicated page',
      indexStatus: 'unknown',
    },
  ]);

  assert.equal(results.length, 3);
  assert.equal(results[0].resultType, 'document');
  assert.equal(results[0].indexStatus, 'INDEXABLE');
  assert.equal(results[1].resultType, 'discovered');
  assert.equal(results[1].indexStatus, 'UNKNOWN');
  assert.equal(results[1].sourceUrl, 'https://example.com/');
  assert.equal(results[0].canonicalStatus, 'cross-origin');
  assert.equal(results[2].url, 'https://publisher.example/story');
  assert.equal(results[2].canonicalStatus, null);
  assert.deepEqual(Object.keys(results[0]), [
    'position',
    'resultType',
    'indexStatus',
    'url',
    'title',
    'description',
    'snippet',
    'canonicalUrl',
    'canonicalStatus',
    'language',
    'fetchedAt',
    'sourceUrl',
    'discoveredAt',
  ]);
});

test('search service isolates discovery and crawler failures from document retrieval', async () => {
  const warnings = [];
  const crawlCalls = [];
  const service = createSearchService({
    repository: {
      async searchDocuments() {
        return [
          { url: 'https://example.com/', title: 'Example' },
          { url: 'https://other.example/', title: 'Other' },
        ];
      },
      async searchDiscoveredUrls() {
        throw new Error('optional discovery table missing');
      },
    },
    crawler: {
      async requestCrawls(urls, limits) {
        crawlCalls.push({ urls, limits });
        throw new Error('crawler temporarily unavailable');
      },
    },
    logger: {
      warn(...args) {
        warnings.push(args);
      },
    },
  });

  const result = await service.search({
    query: 'example',
    matchExpression: '"example"',
    limit: 10,
  });

  assert.equal(result.apiVersion, 1);
  assert.equal(result.count, 2);
  assert.equal(result.results[0].title, 'Example');
  assert.deepEqual(crawlCalls, [{
    urls: ['https://example.com/', 'https://other.example/'],
    limits: { maxPages: 1, maxDepth: 0 },
  }]);
  assert.equal(result.crawl.failed, 2);
  assert.equal(result.crawl.cooldown, 0);
  assert.deepEqual(result.crawl.targets, [
    {
      url: 'https://example.com/',
      status: 'failed',
      reason: 'CRAWLER_REQUEST_FAILED',
      retryAfterAt: null,
    },
    {
      url: 'https://other.example/',
      status: 'failed',
      reason: 'CRAWLER_REQUEST_FAILED',
      retryAfterAt: null,
    },
  ]);
  assert.equal(warnings.length, 2);
});

test('search service only refreshes URLs that survive the final result limit', async () => {
  const submitted = [];
  const rows = Array.from({ length: 15 }, (_, index) => ({
    url: 'https://example.com/' + index,
    title: 'Example ' + index,
  }));
  const service = createSearchService({
    repository: {
      async searchDocuments() { return rows; },
      async searchDiscoveredUrls() { return []; },
    },
    crawler: {
      async requestCrawls(urls) {
        submitted.push(...urls);
        return {
          enabled: true,
          requested: urls.length,
          fresh: 0,
          queued: urls.length,
          deduplicated: 0,
          cooldown: 0,
          failed: 0,
          targets: urls.map((url) => ({
            url,
            status: 'queued',
            reason: 'CRAWL_QUEUED',
            retryAfterAt: null,
          })),
        };
      },
    },
    logger: { warn() {} },
  });

  const result = await service.search({
    query: 'example',
    matchExpression: '"example"',
    limit: 10,
  });

  assert.equal(result.count, 10);
  assert.equal(submitted.length, 10);
  assert.deepEqual(submitted, result.results.map((item) => item.url));
});

test('Rewide Machine client reports every outcome using a stable summary contract', async () => {
  const requests = [];
  const outcomes = [
    new Response(JSON.stringify({
      status: 'fresh',
      fetchedAt: '2026-11-15T00:00:00.000Z',
      ttlExpiresAt: '2026-11-16T00:00:00.000Z',
    }), { status: 200 }),
    new Response(JSON.stringify({
      status: 'cooldown',
      retryAt: '2026-11-17T00:00:00.000Z',
      previousFailureAt: '2026-11-16T00:00:00.000Z',
      errorCode: 'ROBOTS_DISALLOWED',
      upstreamHttpStatus: null,
    }), { status: 200 }),
    new Response(JSON.stringify({
      jobId: 'job-queued',
      status: 'queued',
    }), { status: 202 }),
    new Response(JSON.stringify({
      jobId: 'job-running',
      status: 'running',
      deduplicated: true,
    }), { status: 202 }),
    new Response('upstream error', { status: 502 }),
  ];
  const client = createRewideMachineClient({
    token: 'test-crawler-token-that-is-at-least-24-chars',
    fetcher: async (url, init) => {
      requests.push({ url, init });
      return outcomes[requests.length - 1];
    },
  });

  const summary = await client.requestCrawls([
    'https://fresh.example/',
    'https://cooldown.example/',
    'https://queued.example/',
    'https://duplicate.example/',
    'https://failed.example/',
    'https://fresh.example/',
  ]);

  assert.deepEqual(summary, {
    enabled: true,
    requested: 5,
    fresh: 1,
    queued: 1,
    deduplicated: 1,
    cooldown: 1,
    failed: 1,
    targets: [
      {
        url: 'https://fresh.example/',
        status: 'fresh',
        reason: 'WITHIN_WATCH_TTL',
        retryAfterAt: null,
        fetchedAt: '2026-11-15T00:00:00.000Z',
        ttlExpiresAt: '2026-11-16T00:00:00.000Z',
      },
      {
        url: 'https://cooldown.example/',
        status: 'cooldown',
        reason: 'ROBOTS_DISALLOWED',
        retryAfterAt: '2026-11-17T00:00:00.000Z',
        previousFailureAt: '2026-11-16T00:00:00.000Z',
        upstreamHttpStatus: null,
      },
      {
        url: 'https://queued.example/',
        status: 'queued',
        reason: 'CRAWL_QUEUED',
        retryAfterAt: null,
        jobId: 'job-queued',
      },
      {
        url: 'https://duplicate.example/',
        status: 'deduplicated',
        reason: 'ACTIVE_CRAWL_EXISTS',
        retryAfterAt: null,
        jobId: 'job-running',
      },
      {
        url: 'https://failed.example/',
        status: 'failed',
        reason: 'HTTP_502',
        retryAfterAt: null,
        httpStatus: 502,
      },
    ],
  });
  assert.equal(requests.length, 5);
  assert.equal(requests[0].url, 'https://rewide-machine.dummynet.workers.dev/v1/crawl');
  assert.equal(requests[0].init.headers.authorization, 'Bearer test-crawler-token-that-is-at-least-24-chars');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    url: 'https://fresh.example/',
    maxPages: 1,
    maxDepth: 0,
  });
});

test('Rewide Machine client always returns the same counters when disabled', async () => {
  const client = createRewideMachineClient();
  const summary = await client.requestCrawls(['https://example.com/']);

  assert.deepEqual(summary, {
    enabled: false,
    reason: 'CRAWLER_NOT_CONFIGURED',
    requested: 0,
    fresh: 0,
    queued: 0,
    deduplicated: 0,
    cooldown: 0,
    failed: 0,
    targets: [],
  });
});


test('legacy and versioned search routes share the same CORS preflight handler', () => {
  assert.equal(legacyOptions, versionedOptions);
});

test('search API supports public cross-origin GET preflight without credentials', async () => {
  const response = versionedOptions();

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Accept');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});


test('HTTP discovery adapter normalizes and deduplicates candidate URLs', async () => {
  let request;
  const client = createHttpDiscoveryClient({
    endpoint: 'https://discovery.example/v1/discover',
    token: 'discovery-test-token',
    fetcher: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({
        results: [
          { url: 'https://example.com/page#top', title: 'Ignored provider title' },
          { url: 'https://example.com/page' },
          { url: 'javascript:alert(1)' },
          { url: 'https://user:password@example.com/private' },
          { url: 'https://other.example/article' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await client.discover('human', { limit: 10 });

  assert.deepEqual(result, {
    enabled: true,
    requested: 2,
    urls: [
      'https://example.com/page',
      'https://other.example/article',
    ],
  });
  assert.equal(request.url, 'https://discovery.example/v1/discover');
  assert.equal(request.init.headers.authorization, 'Bearer discovery-test-token');
  assert.deepEqual(JSON.parse(request.init.body), { query: 'human', limit: 10 });
});

test('HTTP discovery adapter reports missing and invalid endpoints without making requests', async () => {
  let called = false;
  const missing = createHttpDiscoveryClient({
    fetcher: async () => { called = true; },
  });
  const invalid = createHttpDiscoveryClient({
    endpoint: 'http://discovery.example/v1/discover',
    fetcher: async () => { called = true; },
  });

  assert.deepEqual(await missing.discover('human'), {
    enabled: false,
    reason: 'DISCOVERY_NOT_CONFIGURED',
    requested: 0,
    urls: [],
  });
  assert.deepEqual(await invalid.discover('human'), {
    enabled: false,
    reason: 'DISCOVERY_URL_INVALID',
    requested: 0,
    urls: [],
  });
  assert.equal(called, false);
});

test('Rewide Machine client reads crawl job statuses with server-side credentials', async () => {
  let request;
  const client = createRewideMachineClient({
    token: 'test-crawler-token-that-is-at-least-24-chars',
    fetcher: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({
        id: '00000000-0000-4000-8000-000000000041',
        url: 'https://example.com/',
        status: 'completed',
        pages_crawled: 1,
        pages_failed: 0,
        pages_skipped: 0,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await client.getJobStatuses([
    '00000000-0000-4000-8000-000000000041',
  ]);

  assert.equal(result.enabled, true);
  assert.deepEqual(result.jobs, [{
    jobId: '00000000-0000-4000-8000-000000000041',
    url: 'https://example.com/',
    status: 'completed',
    pagesCrawled: 1,
    pagesFailed: 0,
    pagesSkipped: 0,
    errorCode: null,
  }]);
  assert.equal(
    request.url,
    'https://rewide-machine.dummynet.workers.dev/v1/jobs/00000000-0000-4000-8000-000000000041',
  );
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.headers.authorization, 'Bearer test-crawler-token-that-is-at-least-24-chars');
});
