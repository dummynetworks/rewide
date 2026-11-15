# Rewide Discovery provider contract

This document defines the HTTP boundary between the Rewide Search API and a separately operated Discovery provider.

The provider finds candidate page URLs for a user query. Rewide does not use provider titles, descriptions, snippets, raw content, or relevance scores as final search results. Rewide fetches candidate pages through `rewide-machine`, stores the extracted documents in its own D1 database, and searches that fetched-document index only after crawl jobs finish.

## Required rights

The provider must explicitly permit all of the following in the applicable plan and agreement:

- Using its output to discover URLs for a public search application.
- Retaining candidate URL metadata in Rewide's own database.
- Fetching candidate pages independently with Rewide's crawler.
- Storing and indexing the independently fetched page content, subject to the publisher's rights, robots.txt, noindex, and applicable law.
- Displaying results generated from Rewide's own fetched documents.

Do not connect a provider whose agreement prohibits creating a search index from its output, prohibits use in a competing search service, or does not grant the required URL-retention rights. Do not infer these permissions from the existence of an API.

## Request

The configured endpoint must accept HTTPS `POST` requests.

Headers:

- `Accept: application/json`
- `Content-Type: application/json`
- Optional `Authorization: Bearer <token>`

Body:

```json
{
  "query": "human",
  "limit": 10
}
```

The query is already validated by Rewide and is limited to 256 characters. The requested limit is from 1 through 10.

## Response

HTTP `200`:

```json
{
  "results": [
    {
      "url": "https://example.com/human"
    },
    {
      "url": "https://docs.example.net/human-guide"
    }
  ]
}
```

Only the `url` property is required. Additional provider fields are ignored and are not stored by Rewide. Candidate URLs must use HTTP or HTTPS and must not contain embedded credentials. Rewide removes URL fragments and duplicate URLs before submission. `rewide-machine` performs its own public-URL validation and robots.txt checks.

## Runtime configuration

Set these variables on the Cloudflare Pages production environment:

| Name | Type | Meaning |
| --- | --- | --- |
| `REWIDE_DISCOVERY_ENABLED` | Variable | Set to `true` to activate discovery-first requests |
| `REWIDE_DISCOVERY_URL` | Variable | Full HTTPS URL of the Discovery endpoint |
| `REWIDE_DISCOVERY_TOKEN` | Secret | Optional Bearer token |

Keep `REWIDE_CRAWLER_TOKEN` configured as before. Discovery credentials are server-side and are never returned in API responses.

Discovery-first mode is deliberately opt-in. Until a provider is configured and its usage rights are checked, the existing indexed-search compatibility mode remains active.

## End-to-end lifecycle

1. Rewide sends the user query to this endpoint once.
2. Rewide normalizes and deduplicates at most 10 returned URLs.
3. Rewide sends each candidate to `POST /v1/crawl` on `rewide-machine`.
4. `rewide-machine` records the discovered URL and checks `watchTTL` against shared D1. Fresh documents are reused; active jobs are deduplicated; eligible stale or unseen URLs are queued; failed URLs follow the retry policy.
5. Rewide returns a status poll URL when jobs are queued or already active.
6. The website polls `GET /api/v1/search/status`. It does not repeat Discovery calls.
7. After every crawl job is terminal, Rewide queries the D1 FTS index and returns only documents fetched and stored by Rewide.

The D1 database remains the authority for document freshness and retry state. The Discovery provider does not own or override Rewide's TTL.
