# GDELT quadgram discovery for Rewide

This tool finds and downloads a recent GDELT Web NGrams quadgram file pair on demand, then extracts candidate article URLs locally. It does not call GDELT search APIs, use an API key, or purchase credits.

## Source format

GDELT's June 30, 2026 Web NGrams release provides a pair of gzip files:

- YYYYMMDDHHMMSS.ngrams.txt.gz: tab-separated DOCID, QUADGRAM, COUNT.
- YYYYMMDDHHMMSS.toc.json.gz: JSON Lines metadata keyed by ID, including article URL, title, date and language.

The DOCID is local to its matching file pair. Never join one NGRAMS file to another timestamp's TOC file.

GDELT's documentation says the quadgram files contain frequency histograms, not article full text. This adapter uses the quadgrams only to select matching document IDs, then extracts URL metadata from the paired TOC. Rewide Machine fetches the original article itself.

## Download the latest snapshot automatically

You do not need to look up timestamps or download two files by hand. From the Rewide repository root, run:

~~~powershell
npm run discover:gdelt -- --latest --query "climate change" --language en --limit 100 --output .\data\gdelt\candidates.ndjson
~~~

The CLI:

1. Starts with the timestamp GDELT recommends checking (UTC, five minutes ago).
2. Tries recent minute-stamped files from newest to oldest because GDELT publishes in short bursts around its 15-minute processing heartbeat.
3. Downloads the NGRAMS file and its TOC using the exact same timestamp.
4. Skips a timestamp when either file is not available (HTTP 404), and stops instead of hammering the host if it receives a rate-limit or server error.
5. Saves the matching pair under `data/gdelt/`, then scans it for the query.

By default it searches back 30 minutes. Increase the window with `--lookback-minutes 60` (maximum 180). If no complete pair is available, rerun later. Do not mix timestamps.

This downloads public data files, not an API response. The upstream host may still impose operational limits or become unavailable; this project does not claim unlimited bandwidth or availability. The scanner reads gzip files directly, so no unzip step is required.

## Scan an already-downloaded pair manually

The `--latest` mode above is the recommended path. You can also pass an existing pair directly:

~~~powershell
npm run discover:gdelt -- --ngrams .\data\gdelt\SNAPSHOT.ngrams.txt.gz --toc .\data\gdelt\SNAPSHOT.toc.json.gz --query "climate change" --language en --limit 100
~~~

Replace `SNAPSHOT` with the shared timestamp in both filenames.

## Optional submission to Rewide Machine

The default scan is read-only and offline. To enqueue selected URLs for Rewide's crawler, add --submit and set the same DUMMYNET_TOKEN secret used by the Worker:

~~~powershell
$secureToken = Read-Host "DUMMYNET_TOKEN" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $env:DUMMYNET_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $submitArgs = @(
      "--ngrams", ".\20261115180000.ngrams.txt.gz",
      "--toc", ".\20261115180000.toc.json.gz",
      "--query", "climate change",
      "--language", "en",
      "--limit", "100",
      "--submit",
      "--submit-limit", "10"
    )
    node tools/gdelt-discovery/src/cli.js @submitArgs
}
finally {
    $env:DUMMYNET_TOKEN = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $secureToken.Dispose()
}
~~~

Submission is sequential, single-page and depth-zero. The default delay is one second between requests. The Worker remains responsible for URL validation, robots.txt, noindex detection, crawl deduplication, the 24-hour document TTL and retry cooldowns. A 401, 403, 429 or 503 response stops further submissions.

After a successful crawl, Rewide search returns the document fetched and indexed by Rewide, not GDELT's metadata. A page blocked by robots or marked noindex is not made indexable by this importer.

## Limits and caveats

- This is a news-discovery source, not general-web discovery.
- Quadgrams are phrase histograms, not complete page text. Terms not represented in a quadgram are not discoverable from that snapshot.
- The source is a minute-level observation with a 15-minute legacy heartbeat; a snapshot is not a continuously complete news index.
- Do not bulk-download the historical archive just to run a keyword search. Start with one recent pair and evaluate relevance.
- GDELT's public data-file access is free, but no claim is made that the upstream host guarantees unlimited bandwidth, request rate or availability. The downloader makes bounded, sequential timestamp checks and stops on rate-limit or server errors.
- Original publisher content remains subject to the publisher's rights and terms. This tool retains only candidate URL metadata and match counts; Rewide independently fetches pages and must continue honoring robots.txt and noindex.

## References

- https://blog.gdeltproject.org/using-the-new-web-ngrams-dataset-to-find-relevant-coverage/
- https://www.gdelt.org/data.html
