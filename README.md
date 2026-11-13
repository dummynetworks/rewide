# rewide

Open-web search by dummyNet.

rewide is an open-web search engine. The application is built with SvelteKit and deployed to Cloudflare Pages using the Cloudflare adapter.

## Interface

The search interface uses an original, browser-native layout inspired by the visual language of [system24](https://github.com/refact0r/system24): monospaced typography, square panel boundaries, compact labels, keyboard-first interaction, and high information density.

This is an independent implementation for a search application, not a port of the Discord theme or its stylesheet.

### Interface rules

- Search and response state take priority over promotional copy.
- Panels use explicit labels and visible boundaries.
- No rounded-card dashboard layout, glass effects, or decorative hero section.
- Keyboard support: `/` focuses the query field; `Escape` clears it.
- The sidebar documents the search scope, retrieval approach, and ranking specification.

## Current state

- SvelteKit application shell and search interface.
- Query-string navigation and browser history support.
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
| `200` | A connected search backend returned a response |
| `400` | Missing, empty, or overlong query |
| `503` | Search backend is not connected |

The intended ranking sequence is:

1. **R — Relevance:** Is it relevant?
2. **Q — Quality:** Is it good?
3. **B — Balance:** Is the overall result balanced?

The crawler is a separate project ([rewide-machine](https://github.com/dummynetworks/rewide-machine)). Crawling, indexing, retrieval, and ranking will be integrated as real services rather than simulated in this frontend.

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
