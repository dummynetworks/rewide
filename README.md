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
- `GET /api/search?q=<query>` remains the website's compatibility endpoint.
- `GET /api/v1/search?q=<query>` is the canonical, versioned search API. Both paths use the same v1 handler and response contract.
- Compatibility search mode retrieves up to 10 documents from the shared D1 FTS5 index and refreshes matching URLs through `rewide-machine`.
- Opt-in discovery-first mode sends the query to a separately configured Discovery provider, submits discovered URLs to `rewide-machine`, waits for crawl jobs to finish through a poll endpoint, and only then queries Rewide's own fetched-document index.
- The shared D1 database is the authority for the 24-hour `watchTTL` and error-aware retry state. Fresh documents are reused; only missing or expired documents are queued.
- Per-URL crawl decisions and retry metadata are returned by the API. Provider titles and snippets are not used as Rewide search results; Rewide displays documents fetched and indexed by its own crawler.
- Recently failed URLs have a separate error-aware retry cooldown, so a robots denial or persistent fetch failure is not retried on every search.
- Compatibility mode can only find URLs already present in the document or discovery index. A new installation using that mode still needs an initial seed import; the Tranco importer in `rewide-machine` is a manual, bounded option and runs as a dry-run unless `--submit` is specified. Discovery-first mode instead gets candidate URLs from its configured provider.
- Search results are rendered in the existing home-page interface.
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

The canonical endpoint is `GET /api/v1/search?q=<query>`. The existing website continues to call `GET /api/search?q=<query>`; that path is a backwards-compatible alias to the same v1 handler. The UI does not need to change when the backend implementation evolves.

- Human-readable contract and integration examples: [docs/api-v1.md](./docs/api-v1.md)
- Machine-readable OpenAPI 3.1 contract: [openapi.json](./openapi.json)
- Public browser integrations are supported through CORS preflight on both the versioned and compatibility routes.

The endpoint is public, read-only, and supports cross-origin browser requests. It does not require authentication. Crawler credentials are only used server-side and are never returned to callers.

Search uses lexical full-text matching: normalized query terms are combined with AND, indexed title and description fields receive higher relevance weight than body text, and at most 10 indexable documents are returned. Document and discovery result sets are merged using reciprocal-rank fusion. This is the retrieval foundation, not the final R/Q/B ranking system.

### Discovery-first search pipeline

Discovery-first mode is staged behind `REWIDE_DISCOVERY_ENABLED=true`. It requires an HTTPS provider endpoint implementing [the Discovery contract](./docs/discovery-provider-contract.md). The provider must permit Rewide to retain candidate URLs and build a public search index from pages fetched independently by Rewide. No third-party provider is enabled by default.

The search endpoint returns a `pollUrl` while crawl jobs are queued. The website polls the status endpoint without repeating the Discovery request. Once all jobs are terminal, Rewide queries the shared D1 FTS index and returns the fetched documents.

### Optional offline GDELT news discovery

Rewide includes an optional CLI importer for GDELT Web NGrams quadgram snapshots. The explicit `--latest` mode probes recent timestamps and downloads a matching NGRAMS/TOC file pair; the scanner then extracts candidate news URLs for a one-to-four-word phrase. It does not call a GDELT search API or connect itself to the public search request path.

The importer can optionally submit selected URL candidates to the existing Rewide Machine Worker. The Worker remains responsible for URL validation, robots.txt, noindex, TTL, retry cooldowns, and fetching the original pages. Only Rewide-fetched documents become normal search results.

- Tool guide: [tools/gdelt-discovery/README.md](./tools/gdelt-discovery/README.md)
- Architecture decision: [docs/architecture/gdelt-quadgram-discovery.md](./docs/architecture/gdelt-quadgram-discovery.md)
- CLI help: `npm run discover:gdelt -- --help`

This is news discovery only, not general web discovery. GDELT's public data files are free to access, but Rewide does not assume unlimited upstream bandwidth or availability.

### On-demand crawler integration

The Pages project can submit result URLs to the existing `rewide-machine` Worker without exposing credentials to browser code. Configure these server-side bindings in the Pages production environment:

| Variable | Type | Value |
| --- | --- | --- |
| `REWIDE_CRAWLER_URL` | Variable (optional) | Defaults to `https://rewide-machine.dummynet.workers.dev` |
| `REWIDE_CRAWLER_TOKEN` | Secret | The same secret value configured as `DUMMYNET_TOKEN` on rewide-machine |

Only `REWIDE_CRAWLER_TOKEN` is required when using the default Worker hostname; set `REWIDE_CRAWLER_URL` only when the crawler API is hosted at a different HTTPS endpoint. The token must be at least 24 characters and must match the `DUMMYNET_TOKEN` secret on rewide-machine. Do not put it in client-side environment variables or commit it to Git. If the crawler secret is absent, search continues to work against D1 and automatic refresh submission remains disabled.

The search service submits at most the 10 URLs in the final result set. Each submission asks for a single-page crawl (`maxPages: 1`, `maxDepth: 0`). The Worker performs the authoritative 24-hour `watchTTL` check and queues only eligible URLs. The search API does not wait for crawls to finish and does not discover URLs that are not already indexed or discovered.

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
