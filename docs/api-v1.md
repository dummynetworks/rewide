# Rewide Search API v1

This document defines the public search API contract. The contract is intentionally independent of the storage engine, retrieval implementation, and crawler provider.

- OpenAPI 3.1 machine-readable definition: [openapi.json](../openapi.json)
- Authentication: none for search requests
- Transport: HTTPS
- Response format: JSON
- CORS: public read-only access with \`Access-Control-Allow-Origin: *\`; credentials are not supported

## Endpoint

\`GET /api/v1/search?q=<query>\`

The legacy \`GET /api/search?q=<query>\` endpoint is a compatibility alias to the same handler. Existing website clients can keep using the legacy path.

## Request

| Field | Type | Required | Constraint |
| --- | --- | --- | --- |
| \`q\` | string | Yes | Trimmed, 1–256 characters, 1–12 searchable letter/number terms |

Search terms are interpreted literally and combined with AND. FTS5 syntax supplied by a client is not executed as an operator.

## Quick start

### curl

\`\`\`sh
curl --get 'https://rewide.devs.surf/api/v1/search' \\
  --header 'Accept: application/json' \\
  --data-urlencode 'q=open web'
\`\`\`

### JavaScript

\`\`\`js
const endpoint = new URL('https://rewide.devs.surf/api/v1/search');
endpoint.searchParams.set('q', 'open web');

const response = await fetch(endpoint, {
  headers: { Accept: 'application/json' },
});

const payload = await response.json();

if (!response.ok) {
  throw new Error(payload.error?.message ?? 'Rewide search failed');
}

console.log(payload.results);
\`\`\`

The endpoint is read-only from the client's perspective. Search refreshes eligible result URLs asynchronously on the server; clients do not receive or need the crawler token.

## Successful response

HTTP \`200\`:

\`\`\`json
{
  "apiVersion": 1,
  "query": "example domain",
  "count": 1,
  "results": [
    {
      "position": 1,
      "resultType": "document",
      "indexStatus": "INDEXABLE",
      "url": "https://example.com/",
      "title": "Example Domain",
      "description": "",
      "snippet": "Example Domain …",
      "canonicalUrl": null,
      "language": "en",
      "fetchedAt": "2026-11-15T00:00:00.000Z",
      "sourceUrl": null,
      "discoveredAt": null
    }
  ],
  "crawl": {
    "enabled": true,
    "requested": 1,
    "fresh": 0,
    "queued": 1,
    "deduplicated": 0,
    "cooldown": 0,
    "failed": 0
  }
}
\`\`\`

### Result fields

| Field | Meaning |
| --- | --- |
| \`position\` | One-based position in the merged result list |
| \`resultType\` | \`document\` for fetched documents; \`discovered\` for known URLs not yet indexed |
| \`indexStatus\` | \`INDEXABLE\` when confirmed indexable; \`UNKNOWN\` when the URL has not yet been fetched and classified |
| \`url\` | URL clients should open |
| \`title\`, \`description\`, \`snippet\` | Display metadata; empty values are allowed where data is not known |
| \`canonicalUrl\`, \`language\`, \`fetchedAt\` | Fetched-document metadata; null for discovery-only results |
| \`sourceUrl\`, \`discoveredAt\` | Discovery metadata; null for fetched-document results |

### Crawl summary fields

Crawl submission is a best-effort side effect. A crawler outage does not turn a successful retrieval into a failed search response.

| Field | Meaning |
| --- | --- |
| \`enabled\` | Whether the crawler integration is configured |
| \`reason\` | Optional reason when integration is disabled |
| \`requested\` | Unique result URLs submitted, capped at 10 |
| \`fresh\` | URLs already fresh under the crawler's success TTL |
| \`queued\` | New crawl jobs queued |
| \`deduplicated\` | URLs already covered by an active job |
| \`cooldown\` | Failed URLs waiting for their retry time |
| \`failed\` | Submissions that could not be accepted or completed |

## Error response

All errors use the same envelope:

\`\`\`json
{
  "apiVersion": 1,
  "error": {
    "code": "INVALID_QUERY",
    "message": "A non-empty q parameter is required."
  }
}
\`\`\`

| HTTP | Code | Meaning |
| --- | --- | --- |
| \`400\` | \`INVALID_QUERY\` | Missing query or no searchable tokens |
| \`400\` | \`QUERY_TOO_LONG\` | More than 256 characters |
| \`400\` | \`QUERY_TOO_COMPLEX\` | More than 12 searchable terms |
| \`500\` | \`SEARCH_QUERY_FAILED\` | Required document retrieval failed |
| \`503\` | \`SEARCH_BACKEND_UNAVAILABLE\` | Pages D1 binding is missing |

## CORS

The search endpoint is public and read-only. It allows cross-origin browser requests:

- \`Access-Control-Allow-Origin: *\`
- \`Access-Control-Allow-Methods: GET, OPTIONS\`
- \`Access-Control-Allow-Headers: Accept\`
- \`Access-Control-Max-Age: 86400\`

No cookies, browser credentials, or authorization headers are required or accepted as part of the search contract. The crawler secret remains server-side.

## Server-side architecture

The HTTP route is an adapter. It validates the request, resolves runtime bindings, and invokes the search application service.

- **Search service** coordinates retrieval, ranking, and best-effort crawl refresh.
- **D1 search repository** owns FTS5 SQL and the current D1 schema.
- **Rewide Machine client** owns the remote Worker URL, authentication, timeout, request body, and response classification.
- **Ranking module** merges source ranks and produces the public result shape.

The website and external clients depend on this API contract, not on D1 tables or Worker request details. Internal adapters may be replaced independently as long as they implement the service ports and preserve the v1 response contract.

## Runtime bindings

| Binding | Type | Required |
| --- | --- | --- |
| \`REWIDE_DB\` | Cloudflare D1 | Yes |
| \`REWIDE_CRAWLER_URL\` | HTTPS URL variable | No |
| \`REWIDE_CRAWLER_TOKEN\` | Secret matching \`rewide-machine\`'s \`DUMMYNET_TOKEN\` | No |

Without crawler credentials, retrieval still works and the response reports a disabled crawler integration. The endpoint never exposes the crawler token to browser code.
