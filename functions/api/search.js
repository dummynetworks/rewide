const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: jsonHeaders,
  });
}

export async function onRequest({ request }) {
  if (request.method !== "GET") {
    return json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Use GET for search requests.",
      },
    }, 405);
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  if (!query) {
    return json({
      error: {
        code: "INVALID_QUERY",
        message: "A non-empty q parameter is required.",
      },
    }, 400);
  }

  if (query.length > 256) {
    return json({
      error: {
        code: "QUERY_TOO_LONG",
        message: "The query must be 256 characters or fewer.",
      },
    }, 400);
  }

  // The search index and retrieval service are intentionally not stubbed.
  // Connect the real retrieval pipeline before returning search results.
  return json({
    error: {
      code: "SEARCH_BACKEND_UNAVAILABLE",
      message: "The rewide search backend is not connected.",
    },
  }, 503);
}
