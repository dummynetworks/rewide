const DEFAULT_CRAWLER_URL = 'https://rewide-machine.dummynet.workers.dev';
const CRAWL_REQUEST_TIMEOUT_MS = 5_000;
const MAX_CRAWL_SUBMISSIONS = 10;

function emptySummary(reason) {
  return {
    enabled: false,
    reason,
    requested: 0,
    fresh: 0,
    queued: 0,
    deduplicated: 0,
    cooldown: 0,
    failed: 0,
  };
}

function resolveCrawlEndpoint(value) {
  try {
    const base = new URL(value || DEFAULT_CRAWLER_URL);
    if (
      base.protocol !== 'https:'
      || base.username
      || base.password
      || base.search
      || base.hash
    ) {
      return null;
    }

    return new URL('/v1/crawl', base).href;
  } catch {
    return null;
  }
}

function normalizeTargets(values) {
  const targets = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string' || value.length > 2_048) continue;

    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol)
        || url.username
        || url.password
      ) {
        continue;
      }

      const normalized = url.href;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      targets.push(normalized);
      if (targets.length >= MAX_CRAWL_SUBMISSIONS) break;
    } catch {
      // Ignore malformed URLs from an upstream search provider.
    }
  }

  return targets;
}

async function classifyResponse(response) {
  if (response.status === 200) {
    const payload = await response.json().catch(() => null);
    if (payload?.status === 'fresh') return 'fresh';
    if (payload?.status === 'cooldown') return 'cooldown';
    return 'failed';
  }

  if (response.status === 202) {
    const payload = await response.json().catch(() => null);
    return payload?.deduplicated === true ? 'deduplicated' : 'queued';
  }

  return 'failed';
}

/**
 * Create the Rewide Machine HTTP adapter.
 *
 * This module owns the remote URL, authentication header, timeout, request
 * payload, and Worker response mapping. Callers only provide target URLs.
 */
export function createRewideMachineClient({
  baseUrl,
  token,
  fetcher = globalThis.fetch,
  timeoutMs = CRAWL_REQUEST_TIMEOUT_MS,
} = {}) {
  const endpoint = resolveCrawlEndpoint(baseUrl);
  const configuredToken = typeof token === 'string' && token.length >= 24;
  const submit = typeof fetcher === 'function' ? fetcher : null;

  return Object.freeze({
    async requestCrawls(urls, { maxPages = 1, maxDepth = 0 } = {}) {
      if (!configuredToken) return emptySummary('CRAWLER_NOT_CONFIGURED');
      if (!endpoint) return emptySummary('CRAWLER_URL_INVALID');
      if (!submit) return emptySummary('CRAWLER_FETCH_UNAVAILABLE');

      if (
        !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50
        || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 5
      ) {
        return emptySummary('CRAWL_LIMITS_INVALID');
      }

      const targets = normalizeTargets(urls);
      const summary = {
        enabled: true,
        requested: targets.length,
        fresh: 0,
        queued: 0,
        deduplicated: 0,
        cooldown: 0,
        failed: 0,
      };

      const outcomes = await Promise.all(targets.map(async (target) => {
        try {
          const response = await submit(endpoint, {
            method: 'POST',
            headers: {
              authorization: 'Bearer ' + token,
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({
              url: target,
              maxPages,
              maxDepth,
            }),
            signal: typeof AbortSignal !== 'undefined'
              && typeof AbortSignal.timeout === 'function'
              ? AbortSignal.timeout(timeoutMs)
              : undefined,
          });

          return await classifyResponse(response);
        } catch {
          return 'failed';
        }
      }));

      for (const outcome of outcomes) {
        summary[outcome] += 1;
      }

      return summary;
    },
  });
}
