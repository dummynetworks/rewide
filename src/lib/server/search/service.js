import { rankSearchResults } from './ranking.js';

function crawlerFailureSummary(urls) {
  return {
    enabled: true,
    requested: urls.length,
    fresh: 0,
    queued: 0,
    deduplicated: 0,
    cooldown: 0,
    failed: urls.length,
    targets: urls.map((url) => ({
      url,
      status: 'failed',
      reason: 'CRAWLER_REQUEST_FAILED',
      retryAfterAt: null,
    })),
  };
}

function serviceError(code, status, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function emptyCrawlSummary() {
  return {
    enabled: true,
    requested: 0,
    fresh: 0,
    queued: 0,
    deduplicated: 0,
    cooldown: 0,
    failed: 0,
    targets: [],
  };
}

async function searchIndexedDocuments(repository, query, matchExpression, limit) {
  const rows = await repository.searchDocuments({ matchExpression, limit });
  const results = rankSearchResults(
    Array.isArray(rows) ? rows : [],
    [],
    { limit },
  );

  return {
    apiVersion: 1,
    query,
    count: results.length,
    results,
  };
}

/**
 * In discovery-first mode, candidate URLs are discovered before any document
 * query. The crawler Worker then asks the shared D1 database to make the
 * authoritative TTL decision. Search documents are read only after crawl jobs
 * finish. Legacy mode remains available until a licensed provider is configured.
 */
export function createSearchService({
  repository,
  crawler,
  discovery,
  discoveryEnabled = false,
  logger = console,
} = {}) {
  if (
    !repository
    || typeof repository.searchDocuments !== 'function'
    || typeof repository.searchDiscoveredUrls !== 'function'
  ) {
    throw new TypeError('A search repository implementing both search methods is required.');
  }

  return Object.freeze({
    async search({ query, matchExpression, limit = 10 }) {
      if (discoveryEnabled) {
        if (!discovery || typeof discovery.discover !== 'function') {
          throw serviceError(
            'DISCOVERY_NOT_CONFIGURED',
            503,
            'A licensed Discovery provider endpoint is required.',
          );
        }

        const discovered = await discovery.discover(query, {
          limit: Math.min(limit, 10),
        });
        if (!discovered.enabled) {
          throw serviceError(
            discovered.reason || 'DISCOVERY_NOT_CONFIGURED',
            503,
            'The Discovery provider is not configured.',
          );
        }

        if (discovered.urls.length === 0) {
          return {
            apiVersion: 1,
            mode: 'discovery-first',
            query,
            count: 0,
            results: [],
            discovery: { enabled: true, requested: 0 },
            crawl: emptyCrawlSummary(),
            pending: false,
          };
        }

        if (!crawler || typeof crawler.requestCrawls !== 'function') {
          throw serviceError(
            'CRAWLER_NOT_CONFIGURED',
            503,
            'The crawl service is not configured.',
          );
        }

        let crawl;
        try {
          crawl = await crawler.requestCrawls(discovered.urls, {
            maxPages: 1,
            maxDepth: 0,
          });
        } catch (error) {
          logger.warn('[rewide] Discovery crawl submission failed.', error);
          crawl = crawlerFailureSummary(discovered.urls);
        }

        if (!crawl.enabled) {
          throw serviceError(
            crawl.reason || 'CRAWLER_NOT_CONFIGURED',
            503,
            'The crawl service is not configured.',
          );
        }

        const jobIds = [...new Set(
          (Array.isArray(crawl.targets) ? crawl.targets : [])
            .filter((target) => (
              ['queued', 'deduplicated'].includes(target.status)
              && typeof target.jobId === 'string'
            ))
            .map((target) => target.jobId),
        )].slice(0, 10);
        const pending = jobIds.length > 0;

        const base = {
          apiVersion: 1,
          mode: 'discovery-first',
          query,
          discovery: {
            enabled: true,
            requested: discovered.urls.length,
          },
          crawl,
          pending,
        };

        if (pending) {
          return {
            ...base,
            count: 0,
            results: [],
            jobIds,
          };
        }

        const indexed = await searchIndexedDocuments(
          repository,
          query,
          matchExpression,
          limit,
        );
        return {
          ...base,
          count: indexed.count,
          results: indexed.results,
        };
      }

      const [documentOutcome, discoveryOutcome] = await Promise.allSettled([
        repository.searchDocuments({ matchExpression, limit }),
        repository.searchDiscoveredUrls({ matchExpression, limit }),
      ]);

      if (documentOutcome.status !== 'fulfilled') {
        throw documentOutcome.reason;
      }

      const documentRows = Array.isArray(documentOutcome.value)
        ? documentOutcome.value
        : [];
      const discoveryRows = discoveryOutcome.status === 'fulfilled'
        && Array.isArray(discoveryOutcome.value)
        ? discoveryOutcome.value
        : [];

      if (discoveryOutcome.status !== 'fulfilled') {
        logger.warn(
          '[rewide] Discovery search is unavailable; returning indexed-document results.',
          discoveryOutcome.reason,
        );
      }

      const results = rankSearchResults(documentRows, discoveryRows, { limit });
      const crawlTargets = results.map((result) => result.url);

      let crawl;
      if (crawler && typeof crawler.requestCrawls === 'function') {
        try {
          crawl = await crawler.requestCrawls(crawlTargets, {
            maxPages: 1,
            maxDepth: 0,
          });
        } catch (error) {
          logger.warn('[rewide] Crawler request failed; search results are unaffected.', error);
          crawl = crawlerFailureSummary(crawlTargets);
        }
      } else {
        crawl = {
          enabled: false,
          reason: 'CRAWLER_NOT_CONFIGURED',
          requested: 0,
          fresh: 0,
          queued: 0,
          deduplicated: 0,
          cooldown: 0,
          failed: 0,
          targets: [],
        };
      }

      return {
        apiVersion: 1,
        mode: 'indexed-legacy',
        query,
        count: results.length,
        results,
        crawl,
        pending: false,
      };
    },
  });
}
