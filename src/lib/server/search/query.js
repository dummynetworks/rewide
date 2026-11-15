export const SEARCH_QUERY_LIMITS = Object.freeze({
  maxLength: 256,
  maxTerms: 12,
});

export function parseSearchQuery(input) {
  const query = typeof input === 'string' ? input.trim() : '';

  if (!query) {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'INVALID_QUERY',
        message: 'A non-empty q parameter is required.',
      },
    };
  }

  if (query.length > SEARCH_QUERY_LIMITS.maxLength) {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'QUERY_TOO_LONG',
        message: 'The query must be 256 characters or fewer.',
      },
    };
  }

  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];

  if (terms.length === 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'INVALID_QUERY',
        message: 'The query must contain at least one letter or number.',
      },
    };
  }

  if (terms.length > SEARCH_QUERY_LIMITS.maxTerms) {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'QUERY_TOO_COMPLEX',
        message: 'The query must contain 12 terms or fewer.',
      },
    };
  }

  // Quote every token and combine with AND. User input cannot inject FTS5
  // operators, column filters, or malformed MATCH syntax.
  const matchExpression = terms
    .map((term) => '"' + term.replaceAll('"', '""') + '"')
    .join(' AND ');

  return {
    ok: true,
    query,
    matchExpression,
  };
}
