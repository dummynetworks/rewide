# Rewide Search API v1

This document defines the public search API contract. The contract is intentionally independent of the storage engine, retrieval implementation, and crawler provider.

- OpenAPI 3.1 machine-readable definition: [openapi.json](../openapi.json)
- Authentication: none for search requests
- Transport: HTTPS
- Response format: JSON
- CORS: public read-only access with `Access-Control-Allow-Origin: *`; credentials are not supported

## Endpoint

`GET /api/v1/search?q=<query>`

The legacy `GET /api/search?q=<query>` endpoint is a compatibility alias to the same handler. Existing website clients can keep using the legacy path.

## Request

| Field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `q` | string | Yes | Trimmed, 1–256 characters, 1–12 searchable letter/number terms |

Search terms are interpreted literally and combined with AND. FTS5 syntax supplied by a client is not executed as an operator.

## Quick start

### curl

```sh
curl --get 'https://rewide.devs.surf/api/v1/search' \
  --header 'Accept: application/json' \
  --data-urlencode 'q=open web'
```

### JavaScript

```js
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
```

The endpoint is read-only from the client's perspective. In discovery-first mode, the server discovers candidate URLs, submits them to the crawler, and returns a poll URL while Queue jobs are running. The client does not receive or need the crawler or Discovery credentials.

## Successful response

HTTP `200`:

```json
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
      "canonicalStatus": "missing",
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
    "failed": 0,
    "targets": [
      {
        "url": "https://example.com/",
        "status": "queued",
        "reason": "CRAWL_QUEUED",
        "retryAfterAt": null,
        "jobId": "d5b8b33b-ef33-4b39-90aa-e4cd0848a4c4"
      }
    ]
  }
}
```

### Result fields

| Field | Meaning |
| --- | --- |
| `position` | One-based position in the merged result list |
| `resultType` | `document` for fetched documents; `discovered` for known URLs not yet indexed |
| `indexStatus` | `INDEXABLE` when confirmed indexable; `UNKNOWN` when the URL has not yet been fetched and classified |
| `url` | URL clients should open |
| `title`, `description`, `snippet` | Display metadata; empty values are allowed where data is not known |
| `canonicalUrl`, `canonicalStatus`, `language`, `fetchedAt` | Fetched-document metadata; null for discovery-only results |
| `sourceUrl`, `discoveredAt` | Discovery metadata; null for fetched-document results |

Canonical status values are `missing`, `self`, `same-origin`, `cross-origin`, `invalid`, or `unverified`. `cross-origin` means the page declares a canonical URL on a different origin; it is retained as metadata only. Rewide does not redirect to it, replace the result's `url`, or deduplicate another fetched/discovered URL solely because it matches a canonical declaration. `unverified` is used for records saved before canonical classification was introduced.

### Discovery-first mode

Discovery-first mode is enabled only when the Pages production environment has `REWIDE_DISCOVERY_ENABLED=true` and a valid `REWIDE_DISCOVERY_URL` configured. The endpoint then performs these steps in order:

1. Send the query to the configured Discovery endpoint.
2. Normalize and deduplicate at most 10 candidate URLs.
3. Submit each candidate to `rewide-machine`.
4. Let the Worker consult the shared D1 database's `watchTTL` and error-aware retry state.
5. Wait for any queued or already-active crawl jobs to reach a terminal state.
6. Search the fetched-document FTS index and return the resulting documents.

While one or more jobs are queued or running, the response has `pending: true`, an empty `results` array, and a `pollUrl`. The website polls that URL; it does not call Discovery again. The status endpoint returns indexed documents only after all supplied jobs are terminal.

The Discovery endpoint is a separately operated HTTPS service. It must accept `POST` JSON with `query` and `limit`, and return `{ "results": [{ "url": "https://example.com/" }] }`. Only candidate URLs are passed to the crawler; provider titles and snippets are not used as Rewide search results. The provider must explicitly permit retaining candidate URLs and using them to fetch, store, and index the resulting pages in a public search application. Do not connect a provider whose terms prohibit search-index creation or using its output to build a competing search service.

When discovery-first mode is disabled, the compatibility indexed-search mode remains active. This keeps current production search available until an approved provider is configured.

### Crawl summary fields

Crawl submission is a best-effort side effect. A crawler outage does not turn a successful retrieval into a failed search response.

| Field | Meaning |
| --- | --- |
| `enabled` | Whether the crawler integration is configured |
| `reason` | Optional reason when integration is disabled |
| `requested` | Unique result URLs submitted, capped at 10 |
| `fresh` | URLs already fresh under the crawler's success TTL |
| `queued` | New crawl jobs queued |
| `deduplicated` | URLs already covered by an active job |
| `cooldown` | Failed URLs waiting for their retry time |
| `failed` | Submissions that could not be accepted or completed |
| `targets` | Per-URL decisions, in submission order; empty when crawler integration is disabled |
| `pending` | Whether discovery-first mode is waiting for queued crawl jobs |
| `pollUrl` | Status endpoint URL to poll while queued jobs are running |

Each `targets` entry contains `url`, `status`, `reason`, and `retryAfterAt`. The status is one of `fresh`, `queued`, `deduplicated`, `cooldown`, or `failed`. `retryAfterAt` is an ISO 8601 timestamp when a retry is deferred, otherwise `null`.

Additional fields are included when the Worker provides them:

| Field | Meaning |
| --- | --- |
| `jobId` | Created or already-active crawl job identifier |
| `fetchedAt`, `ttlExpiresAt` | Fetch timestamp and success-TTL expiry for a fresh URL |
| `previousFailureAt`, `upstreamHttpStatus` | Previous failure metadata for a URL in cooldown |
| `httpStatus` | HTTP status returned by the crawler Worker for a failed request |

The `reason` is a stable machine-readable classification. For a cooldown it uses the previous crawl's error code when available, such as `ROBOTS_DISALLOWED`; otherwise it uses `PREVIOUS_CRAWL_FAILURE`. Queue outcomes use `CRAWL_QUEUED` or `ACTIVE_CRAWL_EXISTS`. Failed Worker responses use the Worker error code or an `HTTP_<status>` fallback. A malformed successful response is reported as `UNEXPECTED_CRAWLER_RESPONSE`, and a transport exception as `CRAWLER_REQUEST_FAILED`.

## Search status endpoint

`GET /api/v1/search/status?q=<query>&jobId=<uuid>`

Repeat the `jobId` parameter for each job, up to 10. This endpoint reads job status through the server-side crawler adapter. It never triggers Discovery or creates new crawl jobs.

While any job is `queued`, `running`, or temporarily unreachable, it returns `pending: true` and no results. Once every job is `completed` or `failed`, the endpoint queries the D1 document index and returns the matching fetched documents.

## Error response

All errors use the same envelope:

```json
{
  "apiVersion": 1,
  "error": {
    "code": "INVALID_QUERY",
    "message": "A non-empty q parameter is required."
  }
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_QUERY` | Missing query or no searchable tokens |
| `400` | `QUERY_TOO_LONG` | More than 256 characters |
| `400` | `QUERY_TOO_COMPLEX` | More than 12 searchable terms |
| `500` | `SEARCH_QUERY_FAILED` | Required document retrieval failed |
| `503` | `SEARCH_BACKEND_UNAVAILABLE` | Pages D1 binding is missing |
| `502` | `DISCOVERY_PROVIDER_FAILED` | Discovery provider request failed |
| `503` | `DISCOVERY_NOT_CONFIGURED` | Discovery-first mode has no configured provider |
| `503` | `CRAWLER_NOT_CONFIGURED` | Crawler credentials or endpoint are unavailable |

## CORS

The search endpoint is public and read-only. It allows cross-origin browser requests:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, OPTIONS`
- `Access-Control-Allow-Headers: Accept`
- `Access-Control-Max-Age: 86400`

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
| `REWIDE_DB` | Cloudflare D1 | Yes |
| `REWIDE_CRAWLER_URL` | HTTPS URL variable | No |
| `REWIDE_CRAWLER_TOKEN` | Secret matching `rewide-machine`'s `DUMMYNET_TOKEN` | No |
| `REWIDE_DISCOVERY_ENABLED` | Set to `true` to enable discovery-first mode | No |
| `REWIDE_DISCOVERY_URL` | HTTPS endpoint implementing the Rewide Discovery HTTP contract | No |
| `REWIDE_DISCOVERY_TOKEN` | Optional Bearer token for the Discovery endpoint | No |

In compatibility indexed-search mode, retrieval still works without crawler credentials and the response reports a disabled crawler integration. Discovery-first mode requires both the Discovery endpoint and the crawler credentials. The endpoint never exposes either credential to browser code.


For the complete request and response contract expected from a Discovery service, see [the Discovery provider contract](./discovery-provider-contract.md).
