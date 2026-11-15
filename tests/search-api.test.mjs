import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/routes/api/search/+server.js';
import { GET as getSearchStatus } from '../src/routes/api/v1/search/status/+server.js';

function makeEvent(query, database, fetcher, crawlerEnv = {}) {
  const url = new URL('https://rewide.example/api/search');
  if (query !== undefined) url.searchParams.set('q', query);
  return {
    url,
    platform: database ? {
      env: { REWIDE_DB: database, ...crawlerEnv },
    } : undefined,
    fetch: fetcher ?? globalThis.fetch,
  };
}

function createDatabase(rows = [], discoveredRows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() {
              return { results: sql.includes('discovered_urls_fts') ? discoveredRows : rows };
            },
          };
        },
      };
    },
  };
}

test('rejects an empty query', async () => {
  const response = await GET(makeEvent('  ', createDatabase()));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.apiVersion, 1);
  assert.equal(body.error.code, 'INVALID_QUERY');
});

test('rejects queries longer than 256 characters', async () => {
  const response = await GET(makeEvent('a'.repeat(257), createDatabase()));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'QUERY_TOO_LONG');
});

test('rejects queries without searchable tokens', async () => {
  const response = await GET(makeEvent('*** --- !!!', createDatabase()));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_QUERY');
});

test('rejects queries with too many terms', async () => {
  const response = await GET(makeEvent(
    Array.from({ length: 13 }, (_, index) => 'term' + index).join(' '),
    createDatabase(),
  ));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'QUERY_TOO_COMPLEX');
});

test('returns an explicit unavailable response without the Pages D1 binding', async () => {
  const response = await GET(makeEvent('open web'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.apiVersion, 1);
  assert.equal(body.error.code, 'SEARCH_BACKEND_UNAVAILABLE');
});

test('queries indexed documents with safely quoted AND terms', async () => {
  const database = createDatabase([{
    url: 'https://example.com/',
    title: 'Example Domain',
    description: 'Documentation example',
    snippet: 'This domain is for documentation …',
    canonicalUrl: null,
    canonicalStatus: 'missing',
    language: 'en',
    fetchedAt: '2026-11-14T00:00:00.000Z',
    relevance: -1.5,
  }]);

  const response = await GET(makeEvent('example domain', database));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.apiVersion, 1);
  assert.equal(body.query, 'example domain');
  assert.equal(body.count, 1);
  assert.equal(body.results[0].position, 1);
  assert.equal(body.results[0].title, 'Example Domain');
  assert.equal(body.results[0].canonicalStatus, 'missing');
  assert.equal(database.calls.length, 2);
  assert.match(database.calls[0].sql, /documents_fts MATCH \?/);
  assert.deepEqual(database.calls[0].values, ['"example" AND "domain"', 10]);
  assert.match(database.calls[1].sql, /discovered_urls_fts MATCH \?/);
  assert.match(database.calls[1].sql, /noindex_status IN \('unknown', 'indexable'\)/);
  assert.match(database.calls[1].sql, /COALESCE\(discovered_urls\.resolved_url, discovered_urls\.url\)/);
  assert.match(database.calls[1].sql, /documents\.no_index = 1/);
});

test('returns discovered URLs without treating UNKNOWN as confirmed indexable', async () => {
  const database = createDatabase([], [{
    url: 'https://example.com/private',
    title: '',
    description: '',
    snippet: 'Private documentation',
    sourceUrl: 'https://example.com/',
    discoveredAt: '2026-11-14T00:00:00.000Z',
    indexStatus: 'unknown',
    relevance: -2,
  }]);
  let crawlerCalled = false;
  const fetcher = async (input, init) => {
    crawlerCalled = true;
    assert.equal(String(input), 'https://rewide-machine.dummynet.workers.dev/v1/crawl');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), {
      url: 'https://example.com/private',
      maxPages: 1,
      maxDepth: 0,
    });
    return new Response(JSON.stringify({
      jobId: 'job-discovered-123',
      url: 'https://example.com/private',
      status: 'queued',
    }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  };

  const response = await GET(makeEvent('private documentation', database, fetcher, {
    REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].url, 'https://example.com/private');
  assert.equal(body.results[0].title, 'https://example.com/private');
  assert.equal(body.results[0].resultType, 'discovered');
  assert.equal(body.results[0].indexStatus, 'UNKNOWN');
  assert.equal(body.results[0].fetchedAt, null);
  assert.equal(body.results[0].sourceUrl, 'https://example.com/');
  assert.equal(body.crawl.enabled, true);
  assert.equal(body.crawl.requested, 1);
  assert.equal(body.crawl.queued, 1);
  assert.deepEqual(body.crawl.targets, [{
    url: 'https://example.com/private',
    status: 'queued',
    reason: 'CRAWL_QUEUED',
    retryAfterAt: null,
    jobId: 'job-discovered-123',
  }]);
  assert.equal(crawlerCalled, true);
});

test('keeps matching referring-link text when the fetched target document does not match', async () => {
  const database = createDatabase([], [{
    url: 'https://example.com/private',
    title: '',
    description: '',
    snippet: 'Architecture reference',
    sourceUrl: 'https://example.com/',
    resolvedUrl: 'https://example.com/private/index.html',
    discoveredAt: '2026-11-14T00:00:00.000Z',
    indexStatus: 'unknown',
    relevance: -1,
  }]);

  const response = await GET(makeEvent('architecture reference', database));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].url, 'https://example.com/private');
  assert.equal(body.results[0].resultType, 'discovered');
  assert.equal(body.results[0].indexStatus, 'UNKNOWN');
});

test('keeps indexed-document results when the optional discovery FTS query fails', async () => {
  const database = {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes('discovered_urls_fts')) {
                throw new Error('no such table: discovered_urls_fts');
              }
              return { results: [{
                url: 'https://example.com/',
                title: 'Example Domain',
                description: 'Documentation example',
                snippet: 'Example result',
                canonicalUrl: null,
                language: 'en',
                fetchedAt: '2026-11-14T00:00:00.000Z',
                relevance: -1,
              }] };
            },
          };
        },
      };
    },
  };

  const response = await GET(makeEvent('example', database));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].title, 'Example Domain');
});

test('treats FTS operators as literal search terms', async () => {
  const database = createDatabase();
  await GET(makeEvent('cats OR dogs', database));

  assert.deepEqual(database.calls[0].values, ['"cats" AND "OR" AND "dogs"', 10]);
});

test('does not expose database error details', async () => {
  const database = {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              throw new Error('private database details');
            },
          };
        },
      };
    },
  };

  const response = await GET(makeEvent('example', database));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'SEARCH_QUERY_FAILED');
});

test('submits only returned indexed URLs to rewide-machine without changing search results', async () => {
  const database = createDatabase([{
    url: 'https://example.com/',
    title: 'Example Domain',
    description: 'Documentation example',
    snippet: 'This domain is for documentation …',
    canonicalUrl: null,
    language: 'en',
    fetchedAt: '2026-11-14T00:00:00.000Z',
    relevance: -1.5,
  }]);
  const calls = [];
  const fetcher = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      jobId: 'job-123',
      url: 'https://example.com/',
      status: 'queued',
    }), { status: 202, headers: { 'content-type': 'application/json' } });
  };

  const response = await GET(makeEvent('example', database, fetcher, {
    REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].title, 'Example Domain');
  assert.deepEqual(body.crawl, {
    enabled: true,
    requested: 1,
    fresh: 0,
    queued: 1,
    deduplicated: 0,
    cooldown: 0,
    failed: 0,
    targets: [{
      url: 'https://example.com/',
      status: 'queued',
      reason: 'CRAWL_QUEUED',
      retryAfterAt: null,
      jobId: 'job-123',
    }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://rewide-machine.dummynet.workers.dev/v1/crawl');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-crawler-token-that-is-at-least-24-chars');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    url: 'https://example.com/',
    maxPages: 1,
    maxDepth: 0,
  });
});

test('reports the crawler retry cooldown without failing search', async () => {
  const database = createDatabase([{
    url: 'https://example.com/',
    title: 'Example Domain',
    description: '',
    snippet: 'Example snippet',
    canonicalUrl: null,
    language: 'en',
    fetchedAt: '2026-11-13T00:00:00.000Z',
    relevance: -1,
  }]);
  const fetcher = async () => new Response(JSON.stringify({
    url: 'https://example.com/',
    status: 'cooldown',
    cached: true,
    crawlRequired: false,
    retryAt: '2026-11-16T00:00:00.000Z',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const response = await GET(makeEvent('example', database, fetcher, {
    REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.crawl.cooldown, 1);
  assert.equal(body.crawl.failed, 0);
  assert.deepEqual(body.crawl.targets, [{
    url: 'https://example.com/',
    status: 'cooldown',
    reason: 'PREVIOUS_CRAWL_FAILURE',
    retryAfterAt: '2026-11-16T00:00:00.000Z',
  }]);
});

test('keeps search working when crawler credentials are not configured', async () => {
  const database = createDatabase([{
    url: 'https://example.com/',
    title: 'Example Domain',
    description: '',
    snippet: 'Example snippet',
    canonicalUrl: null,
    language: 'en',
    fetchedAt: '2026-11-14T00:00:00.000Z',
    relevance: -1,
  }]);
  let called = false;
  const fetcher = async () => {
    called = true;
    throw new Error('Crawler should not be called without credentials.');
  };

  const response = await GET(makeEvent('example', database, fetcher));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.crawl.enabled, false);
  assert.equal(body.crawl.reason, 'CRAWLER_NOT_CONFIGURED');
  assert.equal(body.crawl.cooldown, 0);
  assert.deepEqual(body.crawl.targets, []);
  assert.equal(called, false);
});

test('does not fail search when the crawler endpoint rejects or is unavailable', async () => {
  const database = createDatabase([{
    url: 'https://example.com/',
    title: 'Example Domain',
    description: '',
    snippet: 'Example snippet',
    canonicalUrl: null,
    language: 'en',
    fetchedAt: '2026-11-14T00:00:00.000Z',
    relevance: -1,
  }]);
  const fetcher = async () => new Response(JSON.stringify({
    error: 'UNAUTHORIZED',
  }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

  const response = await GET(makeEvent('example', database, fetcher, {
    REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.crawl.failed, 1);
  assert.deepEqual(body.crawl.targets, [{
    url: 'https://example.com/',
    status: 'failed',
    reason: 'UNAUTHORIZED',
    retryAfterAt: null,
    httpStatus: 401,
  }]);
});


test('discovery-first search discovers URLs before submitting crawl jobs and does not show un-fetched results', async () => {
  const database = createDatabase([{
    url: 'https://example.com/human',
    title: 'Human knowledge',
    description: 'A fetched document',
    snippet: 'A fetched result',
    canonicalUrl: null,
    language: 'en',
    fetchedAt: '2026-11-15T00:00:00.000Z',
    relevance: -1,
  }]);
  const calls = [];
  const fetcher = async (input, init) => {
    const target = String(input);
    calls.push({ target, init });

    if (target === 'https://discovery.example/v1/discover') {
      return new Response(JSON.stringify({
        results: [
          { url: 'https://example.com/human' },
          { url: 'https://example.com/human#section' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (target === 'https://rewide-machine.dummynet.workers.dev/v1/crawl') {
      return new Response(JSON.stringify({
        jobId: '00000000-0000-4000-8000-000000000041',
        url: 'https://example.com/human',
        status: 'queued',
      }), { status: 202, headers: { 'content-type': 'application/json' } });
    }

    throw new Error('Unexpected request: ' + target);
  };

  const response = await GET(makeEvent('human', database, fetcher, {
    REWIDE_DISCOVERY_ENABLED: 'true',
    REWIDE_DISCOVERY_URL: 'https://discovery.example/v1/discover',
    REWIDE_DISCOVERY_TOKEN: 'test-discovery-token',
    REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.mode, 'discovery-first');
  assert.equal(body.pending, true);
  assert.equal(body.count, 0);
  assert.deepEqual(body.results, []);
  assert.equal(body.discovery.requested, 1);
  assert.equal(body.crawl.queued, 1);
  assert.match(body.pollUrl, /^\/api\/v1\/search\/status\?/);
  assert.match(body.pollUrl, /jobId=00000000-0000-4000-8000-000000000041/);
  assert.equal(calls[0].target, 'https://discovery.example/v1/discover');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-discovery-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'human', limit: 10 });
  assert.equal(calls[1].target, 'https://rewide-machine.dummynet.workers.dev/v1/crawl');
  assert.equal(database.calls.length, 0, 'D1 document search must wait until crawl completion');
});

test('discovery-first search returns D1 documents immediately when every URL is already fresh', async () => {
  const database = createDatabase([{
    url: 'https://example.com/human',
    title: 'Human knowledge',
    description: '',
    snippet: 'Fetched page',
    canonicalUrl: null,
    language: 'en',
    fetchedAt: '2026-11-15T00:00:00.000Z',
    relevance: -1,
  }]);
  const fetcher = async (input) => {
    const target = String(input);
    if (target === 'https://discovery.example/v1/discover') {
      return new Response(JSON.stringify({
        results: [{ url: 'https://example.com/human' }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      url: 'https://example.com/human',
      status: 'fresh',
      fetchedAt: '2026-11-15T00:00:00.000Z',
      ttlExpiresAt: '2026-11-16T00:00:00.000Z',
    }), { status: 200 });
  };

  const response = await GET(makeEvent('human', database, fetcher, {
    REWIDE_DISCOVERY_ENABLED: 'true',
    REWIDE_DISCOVERY_URL: 'https://discovery.example/v1/discover',
    REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pending, false);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].title, 'Human knowledge');
  assert.equal(body.crawl.fresh, 1);
  assert.equal(body.results[0].resultType, 'document');
});

test('discovery-first search refuses to silently fall back when its provider is not configured', async () => {
  const response = await GET(makeEvent('human', createDatabase(), undefined, {
    REWIDE_DISCOVERY_ENABLED: 'true',
    REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
  }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'DISCOVERY_NOT_CONFIGURED');
});

test('search status endpoint returns indexed documents only after every crawl job is terminal', async () => {
  const database = createDatabase([{
    url: 'https://example.com/human',
    title: 'Human knowledge',
    description: '',
    snippet: 'Crawled content',
    canonicalUrl: null,
    language: 'en',
    fetchedAt: '2026-11-15T00:00:00.000Z',
    relevance: -1,
  }]);
  const url = new URL('https://rewide.example/api/v1/search/status');
  url.searchParams.set('q', 'human');
  url.searchParams.append('jobId', '00000000-0000-4000-8000-000000000041');
  const fetcher = async (input, init) => {
    assert.equal(String(input), 'https://rewide-machine.dummynet.workers.dev/v1/jobs/00000000-0000-4000-8000-000000000041');
    assert.equal(init.method, 'GET');
    return new Response(JSON.stringify({
      id: '00000000-0000-4000-8000-000000000041',
      url: 'https://example.com/human',
      status: 'completed',
      pages_crawled: 1,
      pages_failed: 0,
      pages_skipped: 0,
      error_code: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const response = await getSearchStatus({
    url,
    platform: {
      env: {
        REWIDE_DB: database,
        REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
      },
    },
    fetch: fetcher,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pending, false);
  assert.equal(body.count, 1);
  assert.equal(body.results[0].title, 'Human knowledge');
  assert.equal(body.jobs[0].status, 'completed');
});

test('search status endpoint does not query documents while crawl jobs are running', async () => {
  const database = createDatabase([{
    url: 'https://example.com/human',
    title: 'Should not be visible yet',
    description: '',
    snippet: 'Still pending',
    canonicalUrl: null,
    language: 'en',
    fetchedAt: '2026-11-15T00:00:00.000Z',
    relevance: -1,
  }]);
  const url = new URL('https://rewide.example/api/v1/search/status?q=human&jobId=00000000-0000-4000-8000-000000000041');
  const response = await getSearchStatus({
    url,
    platform: {
      env: {
        REWIDE_DB: database,
        REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
      },
    },
    fetch: async () => new Response(JSON.stringify({
      id: '00000000-0000-4000-8000-000000000041',
      url: 'https://example.com/human',
      status: 'running',
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pending, true);
  assert.deepEqual(body.results, []);
  assert.equal(database.calls.length, 0);
});
