# Rewide Pagefind snapshot indexer

This is an isolated, offline index-building experiment. It does **not** replace Rewide's live D1 FTS5 index and is not imported by the Cloudflare Pages or `rewide-machine` Worker runtime.

## Requirements

- Node.js 20.19 or later
- npm

## Install

From the repository root:

```sh
npm install --prefix tools/pagefind-indexer
```

## Build a snapshot

The input is newline-delimited JSON (one document object per line):

```sh
npm run build --prefix tools/pagefind-indexer -- \
  --input tools/pagefind-indexer/examples/sample-documents.ndjson \
  --output tools/pagefind-indexer/dist/pagefind
```

The builder writes a Pagefind bundle into the output directory. The output directory can be hosted as static files. Generated bundles are build artifacts and should not be committed as source data.

For a D1 export, provide records with this shape:

```json
{
  "url": "https://example.com/article",
  "title": "Example article",
  "description": "A short summary",
  "language": "en",
  "text": "The extracted page text...",
  "fetchedAt": "2026-11-15T00:00:00.000Z",
  "indexable": true,
  "noIndex": false
}
```

Required fields are `url`, `language`, and `text`. The builder also accepts `fetched_at` and `no_index` field spellings used by SQL exports. The language must be recognizable as an ISO 639-1 language code; common three-letter Common Crawl codes (for example `eng`, `kor`, and `jpn`) are normalized to two-letter codes. Records with unknown languages are skipped rather than being silently labelled as English.

## Guardrails

- HTTP and HTTPS URLs only; embedded URL credentials are rejected.
- URL fragments are removed before deduplication.
- Explicitly non-indexable and `noindex` records are skipped.
- Documents without a recognized language or usable text are skipped.
- The default build limit is 10,000 records. Set `--limit` to a value from 1 to 1,000,000 to change it.
- The index is written to a staging directory and then replaces the previous output directory.
- The script does not fetch websites, decide crawl TTL, or bypass robots.txt.

## Runtime boundary

Pagefind's Node API communicates with its indexing binary. Run this package in a normal Node.js environment such as a local development machine or CI runner. Do not import it into Cloudflare Workers. The generated Pagefind bundle is static and can be served by a static host.

The browser-side Pagefind API can then be initialized from the hosted bundle:

```js
const pagefind = await import("/pagefind/pagefind.js");
const search = await pagefind.search("example");
const results = await Promise.all(search.results.map((result) => result.data()));
```

This package is intentionally not wired into `/api/search`. Pagefind builds a static snapshot; Rewide's D1 FTS5 index remains the live search source of truth until a separate refresh, publication, and consistency design is validated.
