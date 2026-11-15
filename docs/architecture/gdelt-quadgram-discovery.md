# GDELT quadgram discovery adapter

## Decision

GDELT Web NGrams is approved only as an optional, manually staged news-discovery input. It is not a general-web search provider and is not called from the public Rewide search request path.

This boundary is deliberate:

- Search APIs and paid/limited query services do not meet Rewide's source-selection requirement.
- GDELT publishes public data files that can be processed locally without making a keyword-search API request.
- The data is a per-minute quadgram histogram plus a matching document TOC, not full article text.
- The upstream publisher's service availability and bandwidth are not guaranteed to be unlimited. Therefore the adapter does not poll or download files automatically.

## Processing

1. Obtain one NGRAMS and TOC pair for the exact same UTC timestamp from the GDELT public data directory.
2. Run the local scanner against the pair and the user's query.
3. Match one-to-four-word phrases against quadgrams.
4. Resolve matching document IDs through the paired TOC and normalize/deduplicate URLs.
5. Optionally submit selected URLs to Rewide Machine, one at a time.
6. Rewide Machine independently checks public URL validity, robots.txt, noindex, TTL, retry cooldowns and crawl status.
7. Rewide search returns only documents actually fetched and indexed by Rewide.

## Non-goals

- No GDELT API calls.
- No automatic polling or downloading.
- No historical backfile bulk ingestion.
- No use of GDELT titles or quadgram fragments as Rewide's fetched-document search results.
- No changes to the public search API, UI, D1 schema, FTS5 index or TTL rules.
- No assertion that GDELT's public data host provides unlimited transfer capacity.

## Implementation

The standalone Node.js utility lives in tools/gdelt-discovery. It uses only Node.js built-ins, reads gzip or plain-text files, streams rows, and writes candidate JSONL. The optional submit flag talks only to the user's own Rewide Machine Worker and requires its existing secret.

Tests live in tests/gdelt-discovery.test.mjs and use local gzip fixtures and mocked Worker responses.
