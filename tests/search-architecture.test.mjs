import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSearchResults } from '../src/lib/server/search/ranking.js';
import { createSearchService } from '../src/lib/server/search/service.js';
import { createRewideMachineClient } from '../src/lib/server/integrations/rewide-machine-client.js';
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
      canonicalUrl: 'https://example.com/',
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
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[0].resultType, 'document');
  assert.equal(results[0].indexStatus, 'INDEXABLE');
  assert.equal(results[1].resultType, 'discovered');
  assert.equal(results[1].indexStatus, 'UNKNOWN');
  assert.equal(results[1].sourceUrl, 'https://example.com/');
  assert.deepEqual(Object.keys(results[0]), [
    'position',
    'resultType',
    'indexStatus',
    'url',
    'title',
    'description',
    'snippet',
    'canonicalUrl',
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
    new Response(JSON.stringify({ status: 'fresh' }), { status: 200 }),
    new Response(JSON.stringify({ status: 'cooldown' }), { status: 200 }),
    new Response(JSON.stringify({ status: 'queued' }), { status: 202 }),
    new Response(JSON.stringify({ deduplicated: true }), { status: 202 }),
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
