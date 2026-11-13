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
- `GET /api/search?q=<query>` retrieves up to 10 documents from the shared D1 FTS5 index.
- Search results are rendered in the home-page interface.
- Search binding absence is reported explicitly as `503 SEARCH_BACKEND_UNAVAILABLE`.

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

The first retrieval milestone queries the D1 FTS5 index maintained by [rewide-machine](https://github.com/dummynetworks/rewide-machine).

| Status | Meaning |
| --- | --- |
| `200` | Search completed; `results` contains zero or more indexed documents |
| `400` | Missing, empty, overlong, or overly complex query |
| `500` | Search query failed |
| `503` | The Pages D1 binding is not configured |

Search currently uses lexical full-text matching: normalized query terms are combined with AND, indexed title and description fields receive higher relevance weight than body text, and at most 10 indexable documents are returned. This is the retrieval foundation, not the final R/Q/B ranking system.

### Cloudflare Pages D1 binding

The rewide Pages project must read the same D1 database used by the crawler:

| Setting | Value |
| --- | --- |
| Binding variable name | `REWIDE_DB` |
| D1 database | `rewide-machine-db` |

In Cloudflare, open **Workers & Pages → rewide → Settings → Bindings → Add → D1 database**. Set the variable name to `REWIDE_DB`, select the existing `rewide-machine-db` database, save, and redeploy the Pages project. SvelteKit server endpoints access the binding through `platform.env.REWIDE_DB`.

Before connecting the Pages binding, apply the `0003_documents_fts.sql` migration from the `rewide-machine` repository to the remote D1 database. The migration builds the FTS5 index for documents already stored and installs triggers to keep the index synchronized with later document inserts, updates, and deletes.


## Geographic data

Country geometry is based on [Natural Earth 1:110m Admin 0 countries](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/). Natural Earth data is public domain.

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
