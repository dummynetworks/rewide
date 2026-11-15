# GDELT quadgram discovery adapter

## Decision

GDELT Web NGrams is approved only as an optional, manually staged news-discovery input. It is not a general-web search provider and is not called from the public Rewide search request path.

This boundary is deliberate:

- Search APIs and paid/limited query services do not meet Rewide's source-selection requirement.
- GDELT publishes public data files that can be processed locally without making a keyword-search API request.
- The data is a per-minute quadgram histogram plus a matching document TOC, not full article text.
- The upstream publisher's service availability and bandwidth are not guaranteed to be unlimited. Therefore the adapter does not run background polling; a user explicitly starts a bounded, sequential latest-file download from the CLI.

## Processing

1. Run the CLI with `--latest`; it probes recent UTC timestamps newest-first, beginning five minutes in the past, until it finds a complete NGRAMS/TOC pair.
2. The downloader skips expected HTTP 404 responses, but aborts on rate-limit or server errors rather than retrying aggressively.
3. Match one-to-four-word phrases against quadgrams.
4. Resolve matching document IDs through the paired TOC, validate URLs without repairing suspicious values, and normalize/deduplicate accepted URLs.
5. Preserve rejected TOC URL values and stable reason codes through the optional `--rejected-output` JSONL file.
6. Optionally submit selected URLs to Rewide Machine, one at a time.
7. Rewide Machine independently checks public URL validity, robots.txt, noindex, TTL, retry cooldowns and crawl status.
8. Rewide search returns only documents actually fetched and indexed by Rewide.

## URL provenance and validation

GDELT URL values are treated as untrusted source metadata. The adapter rejects suspicious HTML-attribute contamination (for example, an encoded `%20class=` suffix) and raw whitespace/control characters instead of truncating or guessing a corrected URL. The rejected-record JSONL output retains the original value and a stable rejection reason for inspection.

Candidate schema version 2 separates `sourceTimestamp` (the timestamp in the NGRAMS/TOC filename) from `gdeltRecordDate` (the date field in the matching TOC record). The latter is not assumed to be the publisher's publication date.

## Non-goals

- No GDELT API calls.
- No background polling or scheduled downloads.
- No historical backfile bulk ingestion.
- No use of GDELT titles or quadgram fragments as Rewide's fetched-document search results.
- No changes to the public search API, UI, D1 schema, FTS5 index or TTL rules.
- No assertion that GDELT's public data host provides unlimited transfer capacity.

## Implementation

The standalone Node.js utility lives in tools/gdelt-discovery. It uses only Node.js built-ins, can locate and download one recent complete file pair with bounded sequential requests, reads gzip or plain-text files, streams rows, and writes candidate JSONL. The optional submit flag talks only to the user's own Rewide Machine Worker and requires its existing secret.

Tests live in tests/gdelt-discovery.test.mjs and use local gzip fixtures and mocked Worker responses.
