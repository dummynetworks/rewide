# rewide

Open-web search by dummyNet.

rewide is an open-web search engine built with SvelteKit and deployed to Cloudflare Pages.

## Interface

The home screen is a full-screen black canvas. A real 3D sphere is rendered with Three.js/WebGL and slowly rotates. Its WebGL output is sampled and redrawn by a 2D Canvas as a screen-space dotted grid. The search field sits directly on the black surface; it is not wrapped in a window or dashboard panel.

The geographic texture is drawn from Natural Earth country polygons.

## Network distribution data

The optional \`/api/earth\` endpoint reads Cloudflare Radar's HTTP request distribution by country. It requires a Cloudflare Pages secret named \`CLOUDFLARE_RADAR_API_TOKEN\`, created with read access to Radar.

The displayed metric is the percentage distribution of HTTP requests observed on Cloudflare's network over a rolling 24-hour window. It is not a measurement of all Internet traffic.

Cloudflare Radar API data is licensed under **CC BY-NC 4.0**. The optional Radar integration is therefore for non-commercial use only unless separate permission is obtained. When enabled, the interface attributes the data to Cloudflare Radar. Do not enable this data feed for a commercial use case without appropriate licensing.

Without the secret, the globe still renders its geographic land and ocean structure, but no traffic values are shown or invented.

## Current state

- SvelteKit application shell and search interface.
- Three.js/WebGL 3D globe.
- Canvas 2D post-processing that converts the WebGL output into a dotted grid.
- Public-domain Natural Earth country geometry.
- Optional Cloudflare Radar country distribution feed (requires a Pages secret).
- Query-string navigation and browser history support.
- \`/\` focuses search; \`Escape\` clears the query.
- \`GET /api/search?q=<query>\` request validation.
- Explicit \`503 SEARCH_BACKEND_UNAVAILABLE\` until a real search retrieval service and index are connected.
- No fabricated search results or fabricated network telemetry.

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

| Setting | Value |
| --- | --- |
| Production branch | \`main\` |
| Framework preset | SvelteKit |
| Build command | \`npm run build\` |
| Build output directory | \`.svelte-kit/cloudflare\` |
| Root directory | \`/\` |

To enable the optional Radar feed, add a Pages secret named \`CLOUDFLARE_RADAR_API_TOKEN\`. The token must have Account > Radar read permission. Do not expose the token to browser code.

The SvelteKit Cloudflare adapter handles route endpoints under \`src/routes\`; the root-level Pages \`functions/\` directory is not used by this adapter.

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

Country geometry is based on [Natural Earth 1:110m Admin 0 countries](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/). Natural Earth data is public domain.

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
