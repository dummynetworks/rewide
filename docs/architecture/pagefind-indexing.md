# Pagefind in Rewide: architecture decision

**Status:** Experimental snapshot builder only  
**Production search:** D1 FTS5 remains authoritative  
**Date:** 2026-11-15

## Decision

Use Pagefind as an isolated, offline snapshot-index experiment. Do not replace the current D1 FTS5 search path or import the Pagefind Node package into either Cloudflare runtime.

The initial implementation is the standalone Node.js package at `tools/pagefind-indexer/`. It accepts normalized document records as NDJSON and writes a static Pagefind bundle. It is deliberately not connected to `GET /api/search`.

## Why Pagefind is outside the Cloudflare Worker

Pagefind's Node.js indexing API communicates with a native indexing binary. Cloudflare Workers expose a constrained Node.js compatibility layer; the `child_process` API is a non-functional stub rather than a way to launch an arbitrary native process. The Pagefind indexing step therefore belongs in a normal Node.js process, such as a local build machine or CI runner.

The generated Pagefind bundle is static and can be hosted as static assets. Browser-side search can load `/pagefind/pagefind.js` and call `pagefind.search(query)`.

## Proposed data flow

```text
Common Crawl WET / WAT / CDXJ
             |
             v
  Offline ingestion + normalization
             |
             v
   NDJSON document snapshot
             |
             v
  Node.js Pagefind index builder
             |
             v
     Static Pagefind bundle
             |
             v
        Static hosting
```

This is a separate snapshot path. It does not replace the live crawl/search path:

```text
User query
   |
   v
Rewide Search API
   |
   v
D1 FTS5 <---- rewide-machine writes fetched documents
   |
   v
Search results
```

D1 remains the source of truth for successfully fetched documents, `watchTTL`, retry state, and immediate search visibility. Pagefind is not responsible for crawl discovery, HTTP fetching, robots.txt, noindex, retry decisions, or TTL.

## Why this is not yet the production search engine

Pagefind's documented Node API creates an index, adds records, and writes a static bundle. It is a build-oriented snapshot API, not a D1-backed index with documented transactional upsert/delete operations. Treat each bundle as a complete snapshot that must be rebuilt and published.

That creates an operational trade-off:

- A complete rebuild can be useful for a bounded corpus snapshot.
- A crawl that finishes moments ago will not automatically appear in an already-published Pagefind bundle.
- Publishing a new bundle requires a separate build and deployment or static-asset publication step.
- Keeping the search API on D1 FTS5 avoids making newly crawled documents wait for a Pagefind rebuild.

Therefore the first Pagefind experiment must measure build time, peak memory, bundle size, multilingual behavior, result ordering, and the cost of rebuilding at representative corpus sizes before any production routing decision.

## Common Crawl integration boundary

Common Crawl exposes WARC page captures, WAT metadata, WET extracted text, and CDXJ URL/capture indexes. CDXJ is useful for locating captures by URL; it is not a full-text keyword index. Keyword search over Common Crawl text requires a separate ingestion/indexing process.

The Pagefind builder accepts normalized records rather than parsing the full Common Crawl archive itself. An ingestion job must map Common Crawl records into the same normalized document shape before indexing. It must also retain capture timestamps and source references so stale archive content is not mistaken for a live fetch.

For live search results, Rewide should still fetch candidate URLs itself through `rewide-machine`, subject to robots.txt and page-level noindex directives.

## Attribution and rights metadata

Common Crawl should be credited as a data source when its archive data is used. A generic footer credit does not grant rights to republish individual pages or override site-specific terms.

The current Rewide document schema stores URL, title, description, language, fetched content, and crawl metadata, but does not reliably store a page author's identity or an applicable content licence. Do not invent author credits. Before displaying page text or excerpts, add a source-attribution model that records only author/licence information actually found and verified. The UI can then show a global Common Crawl data-source credit plus per-result publisher/author/licence attribution when available.

## Current implementation

- `tools/pagefind-indexer/package.json`: isolated dependency on Pagefind 1.6.0.
- `tools/pagefind-indexer/src/build-index.mjs`: bounded NDJSON-to-Pagefind snapshot builder.
- `tools/pagefind-indexer/examples/sample-documents.ndjson`: original English and Korean test records.
- `tools/pagefind-indexer/README.md`: installation and usage instructions.

The builder rejects non-HTTP(S) URLs and embedded URL credentials, removes fragments, deduplicates URLs, excludes non-indexable/noindex records, and skips records with unknown languages rather than silently labelling them English.

## Validation still required

1. Install the isolated package with Node.js 20.19+.
2. Build the included two-record English/Korean sample.
3. Load the output bundle in a static browser page and verify links, excerpts, and Korean matching.
4. Benchmark progressively larger, representative exports.
5. Only then decide whether Pagefind is useful as an auxiliary snapshot index. Keep D1 FTS5 as the live backend until a complete refresh/publication and consistency model is implemented.
