import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/routes/api/search/+server.js';

function makeEvent(query) {
  const url = new URL('https://rewide.example/api/search');
  if (query !== undefined) url.searchParams.set('q', query);
  return { url };
}

test('rejects an empty query', async () => {
  const response = GET(makeEvent('  '));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_QUERY');
});

test('rejects queries longer than 256 characters', async () => {
  const response = GET(makeEvent('a'.repeat(257)));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'QUERY_TOO_LONG');
});

test('returns an explicit unavailable response until the real backend is connected', async () => {
  const response = GET(makeEvent('open web'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).error.code, 'SEARCH_BACKEND_UNAVAILABLE');
});
