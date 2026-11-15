import { requestSearchCrawls } from '../../../lib/server/crawler.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const MAX_QUERY_LENGTH = 256;
const MAX_QUERY_TERMS = 12;
const MAX_RESULTS = 10;
const DOCUMENT_RRF_WEIGHT = 1.15;
const DISCOVERY_RRF_WEIGHT = 1;

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders },
  });
}

function createMatchExpression(query) {
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) return null;
  if (terms.length > MAX_QUERY_TERMS) return undefined;

  // Every token is quoted and joined with AND, so user text cannot inject
  // FTS5 operators, column filters, or malformed MATCH syntax.
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
}

export async function GET({ url, platform, fetch }) {
  const query = (url.searchParams.get('q') ?? '').trim();

  if (!query) {
    return json({
      error: {
        code: 'INVALID_QUERY',
        message: 'A non-empty q parameter is required.',
      },
    }, 400);
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return json({
      error: {
        code: 'QUERY_TOO_LONG',
        message: `The query must be ${MAX_QUERY_LENGTH} characters or fewer.`,
      },
    }, 400);
  }

  const matchExpression = createMatchExpression(query);
  if (matchExpression === null) {
    return json({
      error: {
        code: 'INVALID_QUERY',
        message: 'The query must contain at least one letter or number.',
      },
    }, 400);
  }

  if (matchExpression === undefined) {
    return json({
      error: {
        code: 'QUERY_TOO_COMPLEX',
        message: `The query must contain ${MAX_QUERY_TERMS} terms or fewer.`,
      },
    }, 400);
  }

  const database = platform?.env?.REWIDE_DB;
  if (!database) {
    return json({
      error: {
        code: 'SEARCH_BACKEND_UNAVAILABLE',
        message: 'The rewide search database binding is not configured.',
      },
    }, 503);
  }

  try {
    const [documentResult, discoveryResult] = await Promise.all([
      database.prepare(`
        SELECT
          documents.url AS url,
          documents.title AS title,
          documents.description AS description,
          snippet(documents_fts, 2, '', '', ' … ', 24) AS snippet,
          documents.canonical_url AS canonicalUrl,
          documents.language AS language,
          documents.fetched_at AS fetchedAt,
          bm25(documents_fts, 10.0, 5.0, 1.0) AS relevance
        FROM documents_fts
        INNER JOIN documents
          ON documents.rowid = documents_fts.rowid
        WHERE documents_fts MATCH ?
          AND documents.indexable = 1
        ORDER BY relevance ASC, documents.fetched_at DESC
        LIMIT ?
      `).bind(matchExpression, MAX_RESULTS).all(),
      database.prepare(`
        SELECT
          discovered_urls.url AS url,
          discovered_urls.title AS title,
          discovered_urls.description AS description,
          snippet(discovered_urls_fts, 3, '', '', ' … ', 24) AS snippet,
          discovered_urls.source_url AS sourceUrl,
          discovered_urls.discovered_at AS discoveredAt,
          discovered_urls.noindex_status AS indexStatus,
          bm25(discovered_urls_fts, 2.0, 5.0, 2.0, 8.0) AS relevance
        FROM discovered_urls_fts
        INNER JOIN discovered_urls
          ON discovered_urls.rowid = discovered_urls_fts.rowid
        WHERE discovered_urls_fts MATCH ?
          AND discovered_urls.noindex_status IN ('unknown', 'indexable')
          AND NOT EXISTS (
            SELECT 1
            FROM documents
            WHERE documents.url = COALESCE(discovered_urls.resolved_url, discovered_urls.url)
          )
        ORDER BY relevance ASC, discovered_urls.discovered_at DESC
        LIMIT ?
      `).bind(matchExpression, MAX_RESULTS).all(),
    ]);

    const documentRows = Array.isArray(documentResult?.results) ? documentResult.results : [];
    const discoveryRows = Array.isArray(discoveryResult?.results) ? discoveryResult.results : [];
    const rankedRows = [
      ...documentRows.map((row, index) => ({
        ...row,
        resultType: 'document',
        indexStatus: 'INDEXABLE',
        sourceUrl: null,
        discoveredAt: null,
        rrfScore: DOCUMENT_RRF_WEIGHT / (60 + index + 1),
      })),
      ...discoveryRows.map((row, index) => ({
        ...row,
        resultType: 'discovered',
        indexStatus: row.indexStatus === 'indexable' ? 'INDEXABLE' : 'UNKNOWN',
        canonicalUrl: null,
        language: null,
        fetchedAt: null,
        rrfScore: DISCOVERY_RRF_WEIGHT / (60 + index + 1),
      })),
    ].sort((left, right) => (
      right.rrfScore - left.rrfScore
      || (left.resultType === 'document' ? -1 : 1)
      || String(left.url).localeCompare(String(right.url))
    )).slice(0, MAX_RESULTS);

    // Only fetched documents are refresh candidates. A discovered-only URL may
    // already be robots-blocked, so searching it must not cause repeated retries.
    const crawl = await requestSearchCrawls({
      documents: documentRows,
      env: platform?.env,
      fetcher: fetch,
    });

    return json({
      query,
      count: rankedRows.length,
      results: rankedRows.map((row, index) => ({
        position: index + 1,
        resultType: row.resultType,
        indexStatus: row.indexStatus,
        url: row.url,
        title: row.title || row.url,
        description: row.description || '',
        snippet: row.snippet || '',
        canonicalUrl: row.canonicalUrl || null,
        language: row.language || null,
        fetchedAt: row.fetchedAt || null,
        sourceUrl: row.sourceUrl || null,
        discoveredAt: row.discoveredAt || null,
      })),
      crawl,
    }, 200);
  } catch {
    return json({
      error: {
        code: 'SEARCH_QUERY_FAILED',
        message: 'The search request could not be completed.',
      },
    }, 500);
  }
}
