const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders },
  });
}

export function GET({ url }) {
  const query = (url.searchParams.get('q') ?? '').trim();

  if (!query) {
    return json({
      error: {
        code: 'INVALID_QUERY',
        message: 'A non-empty q parameter is required.',
      },
    }, 400);
  }

  if (query.length > 256) {
    return json({
      error: {
        code: 'QUERY_TOO_LONG',
        message: 'The query must be 256 characters or fewer.',
      },
    }, 400);
  }

  // Do not fabricate results. Connect the real retrieval and index services
  // before replacing this explicit unavailable response.
  return json({
    error: {
      code: 'SEARCH_BACKEND_UNAVAILABLE',
      message: 'The rewide search backend is not connected.',
    },
  }, 503);
}
