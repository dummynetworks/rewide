import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const specification = JSON.parse(
  await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
);

test('OpenAPI definition uses version 3.1 and declares the stable search routes', () => {
  assert.equal(specification.openapi, '3.1.0');
  assert.ok(specification.paths['/api/v1/search'].get);
  assert.ok(specification.paths['/api/v1/search'].options);
  assert.equal(specification.paths['/api/v1/search'].get.operationId, 'searchWeb');
  assert.ok(specification.paths['/api/v1/search'].get.parameters.some(
    (parameter) => parameter.name === 'q' && parameter.required === true,
  ));
});

test('OpenAPI success schema matches the public v1 response envelope', () => {
  const schema = specification.components.schemas.SearchResponse;
  assert.deepEqual(schema.required, ['apiVersion', 'query', 'count', 'results', 'crawl']);
  assert.deepEqual(
    specification.components.schemas.SearchResult.required,
    [
      'position', 'resultType', 'indexStatus', 'url', 'title',
      'description', 'snippet', 'canonicalUrl', 'language', 'fetchedAt',
      'sourceUrl', 'discoveredAt',
    ],
  );
  assert.deepEqual(
    specification.components.schemas.CrawlSummary.required,
    ['enabled', 'requested', 'fresh', 'queued', 'deduplicated', 'cooldown', 'failed', 'targets'],
  );
  assert.deepEqual(
    specification.components.schemas.CrawlTarget.required,
    ['url', 'status', 'reason', 'retryAfterAt'],
  );
});

test('OpenAPI defines the same error statuses and codes as the HTTP adapter', () => {
  const responses = specification.paths['/api/v1/search'].get.responses;
  assert.deepEqual(Object.keys(responses).sort(), ['200', '400', '500', '503']);
  assert.deepEqual(
    specification.components.schemas.ErrorResponse.properties.error.properties.code.enum,
    [
      'INVALID_QUERY',
      'QUERY_TOO_LONG',
      'QUERY_TOO_COMPLEX',
      'SEARCH_QUERY_FAILED',
      'SEARCH_BACKEND_UNAVAILABLE',
    ],
  );
});
