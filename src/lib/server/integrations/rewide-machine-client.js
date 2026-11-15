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
    targets: [],
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

function targetOutcome(url, status, reason, details = {}) {
  const outcome = {
    url,
    status,
    reason,
    retryAfterAt: details.retryAfterAt ?? null,
  };

  for (const field of [
    'jobId',
    'httpStatus',
    'fetchedAt',
    'ttlExpiresAt',
    'previousFailureAt',
    'upstreamHttpStatus',
  ]) {
    if (details[field] !== undefined) outcome[field] = details[field];
  }

  return outcome;
}

async function classifyResponse(response, url) {
  const payload = await response.json().catch(() => null);
  const hasPayload = payload !== null && typeof payload === 'object' && !Array.isArray(payload);

  if (response.status === 200 && hasPayload) {
    if (payload.status === 'fresh') {
      return targetOutcome(url, 'fresh', 'WITHIN_WATCH_TTL', {
        fetchedAt: payload.fetchedAt,
        ttlExpiresAt: payload.ttlExpiresAt,
      });
    }

    if (payload.status === 'cooldown') {
      return targetOutcome(
        url,
        'cooldown',
        typeof payload.errorCode === 'string'
          ? payload.errorCode
          : 'PREVIOUS_CRAWL_FAILURE',
        {
          retryAfterAt: payload.retryAt,
          previousFailureAt: payload.previousFailureAt,
          upstreamHttpStatus: payload.upstreamHttpStatus,
        },
      );
    }

    return targetOutcome(url, 'failed', 'UNEXPECTED_CRAWLER_RESPONSE', {
      httpStatus: response.status,
    });
  }

  if (
    response.status === 202
    && hasPayload
    && typeof payload.jobId === 'string'
    && ['queued', 'running'].includes(payload.status)
  ) {
    if (payload.deduplicated === true) {
      return targetOutcome(url, 'deduplicated', 'ACTIVE_CRAWL_EXISTS', {
        jobId: payload.jobId,
      });
    }

    return targetOutcome(url, 'queued', 'CRAWL_QUEUED', {
      jobId: payload.jobId,
    });
  }

  const reason = hasPayload && typeof payload.error === 'string'
    ? payload.error
    : (response.status === 200 || response.status === 202
      ? 'UNEXPECTED_CRAWLER_RESPONSE'
      : 'HTTP_' + response.status);

  return targetOutcome(url, 'failed', reason, {
    httpStatus: response.status,
  });
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
    async getJobStatuses(jobIds) {
      if (!configuredToken) {
        return { enabled: false, reason: 'CRAWLER_NOT_CONFIGURED', jobs: [] };
      }
      if (!endpoint) {
        return { enabled: false, reason: 'CRAWLER_URL_INVALID', jobs: [] };
      }
      if (!submit) {
        return { enabled: false, reason: 'CRAWLER_FETCH_UNAVAILABLE', jobs: [] };
      }

      const ids = [...new Set(
        (Array.isArray(jobIds) ? jobIds : [])
          .filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)),
      )].slice(0, MAX_CRAWL_SUBMISSIONS);

      const jobs = await Promise.all(ids.map(async (jobId) => {
        try {
          const jobUrl = new URL('/v1/jobs/' + jobId, endpoint).href;
          const response = await submit(jobUrl, {
            method: 'GET',
            headers: {
              authorization: 'Bearer ' + token,
              accept: 'application/json',
            },
            signal: typeof AbortSignal !== 'undefined'
              && typeof AbortSignal.timeout === 'function'
              ? AbortSignal.timeout(timeoutMs)
              : undefined,
          });

          const payload = await response.json().catch(() => null);
          if (response.status === 404) {
            return { jobId, status: 'failed', reason: 'JOB_NOT_FOUND' };
          }
          if (
            !response.ok
            || payload === null
            || typeof payload !== 'object'
            || Array.isArray(payload)
          ) {
            return { jobId, status: 'unknown', reason: 'JOB_STATUS_UNAVAILABLE' };
          }

          return {
            jobId,
            url: typeof payload.url === 'string' ? payload.url : null,
            status: typeof payload.status === 'string' ? payload.status : 'unknown',
            pagesCrawled: Number.isInteger(payload.pages_crawled)
              ? payload.pages_crawled
              : 0,
            pagesFailed: Number.isInteger(payload.pages_failed)
              ? payload.pages_failed
              : 0,
            pagesSkipped: Number.isInteger(payload.pages_skipped)
              ? payload.pages_skipped
              : 0,
            errorCode: typeof payload.error_code === 'string'
              ? payload.error_code
              : null,
          };
        } catch {
          return { jobId, status: 'unknown', reason: 'JOB_STATUS_UNAVAILABLE' };
        }
      }));

      return { enabled: true, jobs };
    },

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
        targets: [],
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

          return await classifyResponse(response, target);
        } catch {
          return targetOutcome(target, 'failed', 'CRAWLER_REQUEST_FAILED');
        }
      }));

      for (const outcome of outcomes) {
        summary[outcome.status] += 1;
        summary.targets.push(outcome);
      }

      return summary;
    },
  });
}
