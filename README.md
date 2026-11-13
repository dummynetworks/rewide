# rewide

Open-web search by dummyNet.

rewide is an open-web search engine built with SvelteKit and deployed to Cloudflare Pages.

## Interface

The home screen is a full-screen black canvas. A real 3D sphere is rendered with Three.js/WebGL and slowly rotates. Its WebGL output is sampled and redrawn by a 2D Canvas as a screen-space dotted grid. The search field sits directly on the black surface; it is not wrapped in a window or dashboard panel.

The geographic texture is drawn from Natural Earth country polygons.

## Internet-use distribution

The `/api/earth` endpoint reads the World Bank World Development Indicators series **IT.NET.USER.ZS — Individuals using the Internet (% of population)**.

The indicator defines an internet user as an individual who has used the Internet from any location in the previous three months. It is an **annual country-level statistic**, not live traffic volume. The API requests the most recent non-empty observation available for each country, so the reported year can differ by country.

The indicator is sourced from the International Telecommunication Union (ITU) and is provided through the World Bank Indicators API. Attribute the source to **International Telecommunication Union (ITU), via World Bank WDI**. The World Bank metadata lists the indicator under **CC BY 4.0**.

The World Bank Indicators API is public and does not require an API key. The endpoint is cached at the edge for one day. When the API is unavailable, the globe keeps its geographic base rendering without inventing data.

## Current state

- SvelteKit application shell and search interface.
- Three.js/WebGL 3D globe.
- Canvas 2D post-processing that converts the WebGL output into a dotted grid.
- Public-domain Natural Earth country geometry.
- World Bank / ITU annual internet-use indicator mapped by ISO-3 country code.
- Query-string navigation and browser history support.
- `/` focuses search; `Escape` clears the query.
- `GET /api/search?q=<query>` request validation.
- Explicit `503 SEARCH_BACKEND_UNAVAILABLE` until a real search retrieval service and index are connected.
- No fabricated search results or fabricated internet-use data.

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

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | SvelteKit |
| Build command | `npm run build` |
| Build output directory | `.svelte-kit/cloudflare` |
| Root directory | `/` |

The SvelteKit Cloudflare adapter handles route endpoints under `src/routes`; the root-level Pages `functions/` directory is not used by this adapter.

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

## Geographic data

Country geometry is based on [Natural Earth 1:110m Admin 0 countries](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/). Natural Earth data is public domain.

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
