import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/routes/api/search/+server.js';

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

function createDatabase(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() {
              return { results: rows };
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
  assert.equal((await response.json()).error.code, 'INVALID_QUERY');
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
  assert.equal((await response.json()).error.code, 'SEARCH_BACKEND_UNAVAILABLE');
});

test('queries indexed documents with safely quoted AND terms', async () => {
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

  const response = await GET(makeEvent('example domain', database));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.query, 'example domain');
  assert.equal(body.count, 1);
  assert.equal(body.results[0].position, 1);
  assert.equal(body.results[0].title, 'Example Domain');
  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0].sql, /documents_fts MATCH \?/);
  assert.deepEqual(database.calls[0].values, ['"example" AND "domain"', 10]);
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

test('submits indexed result URLs to rewide-machine without changing search results', async () => {
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
    failed: 0,
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
  const fetcher = async () => new Response('unauthorized', { status: 401 });

  const response = await GET(makeEvent('example', database, fetcher, {
    REWIDE_CRAWLER_TOKEN: 'test-crawler-token-that-is-at-least-24-chars',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.crawl.failed, 1);
});
