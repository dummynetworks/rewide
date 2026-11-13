const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const MAX_QUERY_LENGTH = 256;
const MAX_QUERY_TERMS = 12;
const MAX_RESULTS = 10;

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

export async function GET({ url, platform }) {
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
    const result = await database.prepare(`
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
    `).bind(matchExpression, MAX_RESULTS).all();

    const rows = Array.isArray(result?.results) ? result.results : [];
    return json({
      query,
      count: rows.length,
      results: rows.map((row, index) => ({
        position: index + 1,
        url: row.url,
        title: row.title || row.url,
        description: row.description || '',
        snippet: row.snippet || '',
        canonicalUrl: row.canonicalUrl || null,
        language: row.language || null,
        fetchedAt: row.fetchedAt,
      })),
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
