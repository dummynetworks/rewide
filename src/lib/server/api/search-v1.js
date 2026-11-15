import { createRewideMachineClient } from '../integrations/rewide-machine-client.js';
import { createD1SearchRepository } from '../search/d1-repository.js';
import { parseSearchQuery } from '../search/query.js';
import { createSearchService } from '../search/service.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const MAX_RESULTS = 10;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * Version 1 search HTTP adapter. Keep this response contract stable for clients.
 */
export async function handleSearchV1({ url, platform, fetch }) {
  const parsed = parseSearchQuery(url.searchParams.get('q'));

  if (!parsed.ok) {
    return json({
      apiVersion: 1,
      error: parsed.error,
    }, parsed.status);
  }

  const env = platform?.env;
  const database = env?.REWIDE_DB;

  if (!database) {
    return json({
      apiVersion: 1,
      error: {
        code: 'SEARCH_BACKEND_UNAVAILABLE',
        message: 'The rewide search database binding is not configured.',
      },
    }, 503);
  }

  try {
    const repository = createD1SearchRepository(database);
    const crawler = createRewideMachineClient({
      baseUrl: env?.REWIDE_CRAWLER_URL,
      token: env?.REWIDE_CRAWLER_TOKEN,
      fetcher: fetch,
    });
    const service = createSearchService({ repository, crawler });
    const payload = await service.search({
      query: parsed.query,
      matchExpression: parsed.matchExpression,
      limit: MAX_RESULTS,
    });

    return json(payload, 200);
  } catch {
    return json({
      apiVersion: 1,
      error: {
        code: 'SEARCH_QUERY_FAILED',
        message: 'The search request could not be completed.',
      },
    }, 500);
  }
}
