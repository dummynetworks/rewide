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

/**
 * Search application service.
 *
 * Ports:
 * - repository.searchDocuments({ matchExpression, limit })
 * - repository.searchDiscoveredUrls({ matchExpression, limit })
 * - crawler.requestCrawls(urls, limits)
 *
 * The service coordinates ports but knows nothing about D1 SQL or Worker HTTP.
 */
export function createSearchService({ repository, crawler, logger = console } = {}) {
  if (
    !repository
    || typeof repository.searchDocuments !== 'function'
    || typeof repository.searchDiscoveredUrls !== 'function'
  ) {
    throw new TypeError('A search repository implementing both search methods is required.');
  }

  return Object.freeze({
    async search({ query, matchExpression, limit = 10 }) {
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
        query,
        count: results.length,
        results,
        crawl,
      };
    },
  });
}
