# rewide

Open-web search by dummyNet.

rewide is an open-web search engine. The application is built with SvelteKit and deployed to Cloudflare Pages using the Cloudflare adapter.

## Interface

The search interface is an original implementation inspired by the visual language of [system24](https://github.com/refact0r/system24), a TUI-style Discord theme. It uses monospaced typography, compact text, panel labels attached to borders, visible separators, and a restrained dark palette.

This is not a port of the Discord theme or its stylesheet. The layout is adapted for a search application.

### Interface rules

- Search and response state take priority over promotional copy.
- Panel names sit on their top borders, with no rounded-card dashboard layout.
- Compact labels and plain text controls keep the interface information-dense.
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
