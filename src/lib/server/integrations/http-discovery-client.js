const DEFAULT_DISCOVERY_LIMIT = 10;
const DISCOVERY_REQUEST_TIMEOUT_MS = 5_000;

function normalizeEndpoint(value) {
  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== 'https:'
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
    ) {
      return null;
    }
    return endpoint.href;
  } catch {
    return null;
  }
}

function normalizeCandidate(value) {
  if (typeof value !== 'string' || value.length > 2_048) return null;

  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || !url.hostname
    ) {
      return null;
    }

    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function makeError(code, status = 502) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

/**
 * HTTP adapter for an independently operated web-discovery provider.
 *
 * Request:  POST { "query": string, "limit": number }
 * Response: { "results": [{ "url": "https://..." }] }
 *
 * Provider titles/snippets are deliberately not persisted. Rewide fetches the
 * discovered URLs itself and builds its own index from the fetched documents.
 */
export function createHttpDiscoveryClient({
  endpoint,
  token,
  fetcher = globalThis.fetch,
  timeoutMs = DISCOVERY_REQUEST_TIMEOUT_MS,
} = {}) {
  const target = endpoint ? normalizeEndpoint(endpoint) : null;
  const request = typeof fetcher === 'function' ? fetcher : null;

  return Object.freeze({
    async discover(query, { limit = DEFAULT_DISCOVERY_LIMIT } = {}) {
      if (!target) {
        return {
          enabled: false,
          reason: endpoint ? 'DISCOVERY_URL_INVALID' : 'DISCOVERY_NOT_CONFIGURED',
          requested: 0,
          urls: [],
        };
      }
      if (!request) throw makeError('DISCOVERY_FETCH_UNAVAILABLE', 503);
      if (
        typeof query !== 'string'
        || query.trim().length === 0
        || query.length > 256
        || !Number.isInteger(limit)
        || limit < 1
        || limit > DEFAULT_DISCOVERY_LIMIT
      ) {
        throw makeError('DISCOVERY_REQUEST_INVALID', 400);
      }

      let response;
      try {
        response = await request(target, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(typeof token === 'string' && token.length > 0
              ? { authorization: 'Bearer ' + token }
              : {}),
          },
          body: JSON.stringify({ query: query.trim(), limit }),
          signal: typeof AbortSignal !== 'undefined'
            && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(timeoutMs)
            : undefined,
        });
      } catch {
        throw makeError('DISCOVERY_PROVIDER_UNAVAILABLE', 502);
      }

      if (!response.ok) {
        throw makeError(
          response.status === 429
            ? 'DISCOVERY_RATE_LIMITED'
            : 'DISCOVERY_PROVIDER_FAILED',
          response.status === 429 ? 503 : 502,
        );
      }

      const payload = await response.json().catch(() => null);
      if (
        payload === null
        || typeof payload !== 'object'
        || Array.isArray(payload)
        || !Array.isArray(payload.results)
      ) {
        throw makeError('DISCOVERY_RESPONSE_INVALID', 502);
      }

      const urls = [];
      const seen = new Set();
      for (const item of payload.results) {
        const url = normalizeCandidate(item?.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
        if (urls.length >= limit) break;
      }

      return {
        enabled: true,
        requested: urls.length,
        urls,
      };
    },
  });
}
