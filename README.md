# rewide

**Search Engine You're watching for.**

rewide is an open-web search engine by dummyNet. The application is built with SvelteKit and deployed to Cloudflare Pages using the Cloudflare adapter.

## Current state

- SvelteKit application shell and search interface.
- Query-string navigation and browser history support.
- Accessible keyboard shortcuts: `/` focuses search; `Escape` clears it.
- `GET /api/search?q=<query>` request validation.
- Explicit `503 SEARCH_BACKEND_UNAVAILABLE` until a real retrieval service and index are connected.
- No fabricated or hard-coded search results.

## Requirements

- Node.js 20.19 or later
- npm

## Development

```sh
npm install
npm run dev
```

## Build and test

```sh
npm run build
npm test
```

## Cloudflare Pages

Connect this repository to a Cloudflare Pages project with these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | SvelteKit |
| Build command | `npm run build` |
| Build output directory | `.svelte-kit/cloudflare` |
| Root directory | `/` (repository root) |

The SvelteKit Cloudflare adapter produces the deployment output. API handlers belong in SvelteKit route files under `src/routes`; the root-level Pages `functions/` directory is not used by this adapter.

## Search API

`GET /api/search?q=<query>`

| Status | Meaning |
| --- | --- |
| `200` | Search completed (not implemented yet) |
| `400` | Missing, empty, or overlong query |
| `503` | Search backend is not connected |

The search pipeline is intended to follow the agreed order:

1. **R — Relevance:** Is it relevant?
2. **Q — Quality:** Is it good?
3. **B — Balance:** Is the overall result balanced?

The crawler is a separate project (`rewide-machine`). Crawling, indexing, retrieval, and ranking will be integrated as real services rather than simulated in this frontend.

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
