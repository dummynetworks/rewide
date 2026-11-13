# rewide

Open-web search by dummyNet.

rewide is an open-web search engine. The application is built with SvelteKit and deployed to Cloudflare Pages using the Cloudflare adapter.

## Interface

The main workspace pairs a slowly rotating, Canvas-rendered dotted Earth with a separate macOS-inspired search window. The interface uses native-style window chrome and restrained desktop surfaces; it does not use Liquid Glass.

The globe's land mask is generated from Natural Earth 1:110m land polygons. The geographic data is public domain. The dot pattern is a geographic visualization only: live network-usage telemetry is not connected and is not represented by fabricated values.

The globe renderer uses the browser's Canvas 2D API and does not add a 3D rendering dependency.

## Current state

- SvelteKit application shell and split Earth/search workspace.
- Canvas-based rotating dotted globe, generated from Natural Earth land geometry.
- Query-string navigation and browser history support.
- \`/\` focuses search; \`Escape\` clears the query.
- \`GET /api/search?q=<query>\` request validation.
- Explicit \`503 SEARCH_BACKEND_UNAVAILABLE\` until a real retrieval service and index are connected.
- No fabricated or hard-coded search results.
- No live global network telemetry feed yet.

## Requirements

- Node.js 20.19 or later
- npm

## Development

\`\`\`sh
npm install
npm run dev
\`\`\`

## Build and test

\`\`\`sh
npm run build
npm test
\`\`\`

## Cloudflare Pages

Connect this repository to a Cloudflare Pages project with these settings:

| Setting | Value |
| --- | --- |
| Production branch | \`main\` |
| Framework preset | SvelteKit |
| Build command | \`npm run build\` |
| Build output directory | \`.svelte-kit/cloudflare\` |
| Root directory | \`/\` (repository root) |

The SvelteKit Cloudflare adapter produces the deployment output. API handlers belong in SvelteKit route files under \`src/routes\`; the root-level Pages \`functions/\` directory is not used by this adapter.

## Search API

\`GET /api/search?q=<query>\`

| Status | Meaning |
| --- | --- |
| \`200\` | A connected search backend returned a response |
| \`400\` | Missing, empty, or overlong query |
| \`503\` | Search backend is not connected |

The intended ranking sequence is:

1. **R — Relevance:** Is it relevant?
2. **Q — Quality:** Is it good?
3. **B — Balance:** Is the overall result balanced?

The crawler is a separate project ([rewide-machine](https://github.com/dummynetworks/rewide-machine)). Crawling, indexing, retrieval, and ranking will be integrated as real services rather than simulated in this frontend.

## Geographic data

The globe land mask is based on [Natural Earth 1:110m land data](https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/). Natural Earth data is public domain.

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
