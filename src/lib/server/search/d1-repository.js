const DOCUMENT_SEARCH_SQL = [
  'SELECT',
  '  documents.url AS url,',
  '  documents.title AS title,',
  '  documents.description AS description,',
  "  snippet(documents_fts, 2, '', '', ' … ', 24) AS snippet,",
  '  documents.canonical_url AS canonicalUrl,',
  '  documents.canonical_status AS canonicalStatus,',
  '  documents.language AS language,',
  '  documents.fetched_at AS fetchedAt,',
  '  bm25(documents_fts, 10.0, 5.0, 1.0) AS relevance',
  'FROM documents_fts',
  'INNER JOIN documents',
  '  ON documents.rowid = documents_fts.rowid',
  'WHERE documents_fts MATCH ?',
  '  AND documents.indexable = 1',
  'ORDER BY relevance ASC, documents.fetched_at DESC',
  'LIMIT ?',
].join('\n');

const DISCOVERY_SEARCH_SQL = [
  'SELECT',
  '  discovered_urls.url AS url,',
  '  discovered_urls.title AS title,',
  '  discovered_urls.description AS description,',
  "  snippet(discovered_urls_fts, 3, '', '', ' … ', 24) AS snippet,",
  '  discovered_urls.source_url AS sourceUrl,',
  '  discovered_urls.resolved_url AS resolvedUrl,',
  '  discovered_urls.discovered_at AS discoveredAt,',
  '  discovered_urls.noindex_status AS indexStatus,',
  '  bm25(discovered_urls_fts, 2.0, 5.0, 2.0, 8.0) AS relevance',
  'FROM discovered_urls_fts',
  'INNER JOIN discovered_urls',
  '  ON discovered_urls.rowid = discovered_urls_fts.rowid',
  'WHERE discovered_urls_fts MATCH ?',
  "  AND discovered_urls.noindex_status IN ('unknown', 'indexable')",
  '  AND NOT EXISTS (',
  '    SELECT 1',
  '    FROM documents',
  '    WHERE documents.url = COALESCE(discovered_urls.resolved_url, discovered_urls.url)',
  '      AND documents.no_index = 1',
  '  )',
  'ORDER BY relevance ASC, discovered_urls.discovered_at DESC',
  'LIMIT ?',
].join('\n');

function getRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

/**
 * D1 adapter for the search repository port.
 *
 * SQL and FTS5 table details stay inside this adapter. Search services depend
 * on the repository methods, not on the database binding or schema.
 */
export function createD1SearchRepository(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('A D1-compatible database binding is required.');
  }

  return Object.freeze({
    async searchDocuments({ matchExpression, limit }) {
      const result = await database
        .prepare(DOCUMENT_SEARCH_SQL)
        .bind(matchExpression, limit)
        .all();

      return getRows(result);
    },

    async searchDiscoveredUrls({ matchExpression, limit }) {
      const result = await database
        .prepare(DISCOVERY_SEARCH_SQL)
        .bind(matchExpression, limit)
        .all();

      return getRows(result);
    },
  });
}
