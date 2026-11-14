const DEFAULT_CRAWLER_URL = 'https://rewide-machine.dummynet.workers.dev';
const CRAWL_REQUEST_TIMEOUT_MS = 5_000;

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

    return new URL('/v1/crawl', base);
  } catch {
    return null;
  }
}

/**
 * Submit the URLs already returned by D1 search to rewide-machine.
 *
 * The machine owns the authoritative 24-hour watchTTL decision. This function
 * only submits bounded, single-page refresh requests and never crawls URLs
 * directly from the Pages runtime.
 */
export async function requestSearchCrawls({
  documents,
  env,
  fetcher,
}) {
  const token = env?.REWIDE_CRAWLER_TOKEN;
  if (typeof token !== 'string' || token.length < 24) {
    return {
      enabled: false,
      reason: 'CRAWLER_NOT_CONFIGURED',
      requested: 0,
      fresh: 0,
      queued: 0,
      deduplicated: 0,
      failed: 0,
    };
  }

  const endpoint = resolveCrawlEndpoint(env?.REWIDE_CRAWLER_URL);
  if (!endpoint) {
    return {
      enabled: false,
      reason: 'CRAWLER_URL_INVALID',
      requested: 0,
      fresh: 0,
      queued: 0,
      deduplicated: 0,
      failed: 0,
    };
  }

  const submit = typeof fetcher === 'function' ? fetcher : fetch;
  const targets = [...new Set(
    (Array.isArray(documents) ? documents : [])
      .map((document) => document?.url)
      .filter((value) => typeof value === 'string' && value.length <= 2_048),
  )];

  const summary = {
    enabled: true,
    requested: targets.length,
    fresh: 0,
    queued: 0,
    deduplicated: 0,
    failed: 0,
  };

  const outcomes = await Promise.all(targets.map(async (target) => {
    try {
      const response = await submit(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          url: target,
          maxPages: 1,
          maxDepth: 0,
        }),
        signal: AbortSignal.timeout(CRAWL_REQUEST_TIMEOUT_MS),
      });

      if (response.status === 200) {
        const payload = await response.json().catch(() => null);
        return payload?.status === 'fresh' ? 'fresh' : 'failed';
      }

      if (response.status === 202) {
        const payload = await response.json().catch(() => null);
        return payload?.deduplicated === true ? 'deduplicated' : 'queued';
      }

      return 'failed';
    } catch {
      return 'failed';
    }
  }));

  for (const outcome of outcomes) {
    summary[outcome] += 1;
  }

  return summary;
}
