# rewide

**Search Engine You're watching for.**

rewide is an open-web search engine by dummyNet. The initial application shell is a dependency-free static site with a Cloudflare Pages Function for the search API boundary.

## Current state

- Search interface and query-string navigation.
- Accessible keyboard shortcuts: `/` focuses search; `Escape` clears it.
- `GET /api/search?q=<query>` request validation.
- Explicit `503 SEARCH_BACKEND_UNAVAILABLE` until a real retrieval service and index are connected.
- No fabricated or hard-coded search results.

## Development

Requires Node.js 20 or later.

```sh
npm test
```

For local Pages development, install Wrangler separately and run:

```sh
npx wrangler pages dev .
```

## Cloudflare Pages

Create a Pages project connected to this repository.

- Production branch: `main`
- Build command: leave empty
- Build output directory: `.`
- Root directory: `/`

The site is static; `functions/api/search.js` is deployed as a Pages Function. Static asset delivery and Function execution are separate Cloudflare usage categories.

## Search API

`GET /api/search?q=<query>`

| Status | Meaning |
| --- | --- |
| `200` | Search completed (not implemented yet) |
| `400` | Missing, empty, or overlong query |
| `405` | Unsupported method |
| `503` | Search backend is not connected |

Error response:

```json
{
  "error": {
    "code": "SEARCH_BACKEND_UNAVAILABLE",
    "message": "The rewide search backend is not connected."
  }
}
```

The search pipeline is intended to follow the agreed order:

1. **R — Relevance:** Is it relevant?
2. **Q — Quality:** Is it good?
3. **B — Balance:** Is the overall result balanced?

The crawler is a separate project (`rewide-machine`). Crawling, indexing, retrieval, and ranking will be integrated as real services rather than simulated in this frontend.

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
