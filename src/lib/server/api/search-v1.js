import { createHttpDiscoveryClient } from '../integrations/http-discovery-client.js';
import { createRewideMachineClient } from '../integrations/rewide-machine-client.js';
import { createD1SearchRepository } from '../search/d1-repository.js';
import { rankSearchResults } from '../search/ranking.js';
import { parseSearchQuery } from '../search/query.js';
import { createSearchService } from '../search/service.js';

const CORS_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Accept',
  'access-control-max-age': '86400',
});

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  ...CORS_HEADERS,
};

const MAX_RESULTS = 10;
const JOB_ID_PATTERN = /^[0-9a-f-]{36}$/i;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function createRuntimeClients(env, fetcher) {
  return {
    repository: env?.REWIDE_DB
      ? createD1SearchRepository(env.REWIDE_DB)
      : null,
    crawler: createRewideMachineClient({
      baseUrl: env?.REWIDE_CRAWLER_URL,
      token: env?.REWIDE_CRAWLER_TOKEN,
      fetcher,
    }),
    discovery: createHttpDiscoveryClient({
      endpoint: env?.REWIDE_DISCOVERY_URL,
      token: env?.REWIDE_DISCOVERY_TOKEN,
      fetcher,
    }),
    discoveryEnabled: env?.REWIDE_DISCOVERY_ENABLED === 'true',
  };
}

/**
 * Public, read-only search API. No user credentials or crawler secrets are
 * accepted from browser clients; cross-origin access is safe for this endpoint.
 */
export function optionsSearchV1() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'cache-control': 'public, max-age=86400',
    },
  });
}

/**
 * Version 1 search adapter. Discovery-first mode is opt-in until a provider
 * with suitable indexing and retention rights is configured.
 */
export async function handleSearchV1({ url, platform, fetch }) {
  const parsed = parseSearchQuery(url.searchParams.get('q'));

  if (!parsed.ok) {
    return json({ apiVersion: 1, error: parsed.error }, parsed.status);
  }

  const env = platform?.env;
  if (!env?.REWIDE_DB) {
    return json({
      apiVersion: 1,
      error: {
        code: 'SEARCH_BACKEND_UNAVAILABLE',
        message: 'The rewide search database binding is not configured.',
      },
    }, 503);
  }

  try {
    const clients = createRuntimeClients(env, fetch);
    const service = createSearchService({
      repository: clients.repository,
      crawler: clients.crawler,
      discovery: clients.discovery,
      discoveryEnabled: clients.discoveryEnabled,
    });
    const payload = await service.search({
      query: parsed.query,
      matchExpression: parsed.matchExpression,
      limit: MAX_RESULTS,
    });

    if (payload.pending && Array.isArray(payload.jobIds) && payload.jobIds.length > 0) {
      const pollUrl = new URL('/api/v1/search/status', url.origin);
      pollUrl.searchParams.set('q', parsed.query);
      for (const jobId of payload.jobIds) {
        pollUrl.searchParams.append('jobId', jobId);
      }
      payload.pollUrl = pollUrl.pathname + pollUrl.search;
      delete payload.jobIds;
    }

    return json(payload, 200);
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'SEARCH_QUERY_FAILED';
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const messages = {
      DISCOVERY_NOT_CONFIGURED: 'A licensed Discovery provider endpoint is required.',
      DISCOVERY_URL_INVALID: 'The Discovery provider URL is invalid.',
      DISCOVERY_FETCH_UNAVAILABLE: 'The Discovery provider cannot be reached.',
      DISCOVERY_PROVIDER_UNAVAILABLE: 'The Discovery provider is unavailable.',
      DISCOVERY_PROVIDER_FAILED: 'The Discovery provider rejected the request.',
      DISCOVERY_RATE_LIMITED: 'The Discovery provider rate limit was reached.',
      DISCOVERY_RESPONSE_INVALID: 'The Discovery provider returned an invalid response.',
      DISCOVERY_REQUEST_INVALID: 'The Discovery request is invalid.',
      CRAWLER_NOT_CONFIGURED: 'The crawl service is not configured.',
      CRAWLER_URL_INVALID: 'The crawl service URL is invalid.',
      CRAWLER_FETCH_UNAVAILABLE: 'The crawl service cannot be reached.',
    };

    return json({
      apiVersion: 1,
      error: {
        code,
        message: messages[code] || 'The search request could not be completed.',
      },
    }, status);
  }
}

/**
 * Polls already-submitted crawl jobs. It never calls Discovery again.
 * Results are queried from D1 only after every submitted job is terminal.
 */
export async function handleSearchStatusV1({ url, platform, fetch }) {
  const parsed = parseSearchQuery(url.searchParams.get('q'));
  if (!parsed.ok) {
    return json({ apiVersion: 1, error: parsed.error }, parsed.status);
  }

  const jobIds = [...new Set(url.searchParams.getAll('jobId'))];
  if (
    jobIds.length < 1
    || jobIds.length > MAX_RESULTS
    || jobIds.some((jobId) => !JOB_ID_PATTERN.test(jobId))
  ) {
    return json({
      apiVersion: 1,
      error: {
        code: 'INVALID_CRAWL_JOBS',
        message: 'Provide between 1 and 10 valid crawl job IDs.',
      },
    }, 400);
  }

  const env = platform?.env;
  if (!env?.REWIDE_DB) {
    return json({
      apiVersion: 1,
      error: {
        code: 'SEARCH_BACKEND_UNAVAILABLE',
        message: 'The rewide search database binding is not configured.',
      },
    }, 503);
  }

  try {
    const { repository, crawler } = createRuntimeClients(env, fetch);
    const status = await crawler.getJobStatuses(jobIds);
    if (!status.enabled) {
      return json({
        apiVersion: 1,
        error: {
          code: status.reason || 'CRAWLER_NOT_CONFIGURED',
          message: 'The crawl job status service is not configured.',
        },
      }, 503);
    }

    const pending = status.jobs.some((job) => (
      !['completed', 'failed'].includes(job.status)
    ));

    if (pending) {
      return json({
        apiVersion: 1,
        query: parsed.query,
        pending: true,
        jobs: status.jobs,
        count: 0,
        results: [],
      }, 200);
    }

    const rows = await repository.searchDocuments({
      matchExpression: parsed.matchExpression,
      limit: MAX_RESULTS,
    });
    const results = rankSearchResults(
      Array.isArray(rows) ? rows : [],
      [],
      { limit: MAX_RESULTS },
    );

    return json({
      apiVersion: 1,
      query: parsed.query,
      pending: false,
      jobs: status.jobs,
      count: results.length,
      results,
    }, 200);
  } catch {
    return json({
      apiVersion: 1,
      error: {
        code: 'SEARCH_QUERY_FAILED',
        message: 'The crawl status request could not be completed.',
      },
    }, 500);
  }
}
