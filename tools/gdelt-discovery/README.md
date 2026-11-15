# GDELT quadgram discovery for Rewide

This tool extracts candidate article URLs from a locally downloaded GDELT Web NGrams quadgram snapshot. It is an offline importer: it does not call GDELT search APIs, use an API key, purchase credits, or download source data.

## Source format

GDELT's June 30, 2026 Web NGrams release provides a pair of gzip files:

- YYYYMMDDHHMMSS.ngrams.txt.gz: tab-separated DOCID, QUADGRAM, COUNT.
- YYYYMMDDHHMMSS.toc.json.gz: JSON Lines metadata keyed by ID, including article URL, title, date and language.

The DOCID is local to its matching file pair. Never join one NGRAMS file to another timestamp's TOC file.

GDELT's documentation says the quadgram files contain frequency histograms, not article full text. This adapter uses the quadgrams only to select matching document IDs, then extracts URL metadata from the paired TOC. Rewide Machine fetches the original article itself.

## Download one snapshot

GDELT recommends requesting a timestamp several minutes in the past. Its legacy processing has a 15-minute heartbeat and publishes short bursts of minute-stamped files. The following PowerShell 7 example selects a conservative timestamp from the latest expected publishing window, then downloads both files using the **same** timestamp:

~~~powershell
$ErrorActionPreference = "Stop"

$base = "https://data.gdeltproject.org/gdeltv5/weblegacy/ngrams"
$now = [DateTimeOffset]::UtcNow.AddMinutes(-5)
$minuteInCycle = $now.Minute % 15

# Expected publication bursts cover minutes 00-04, 15-19, 30-34, and 45-49.
# If the five-minute look-back lands outside a burst, use the previous burst's last minute.
if ($minuteInCycle -gt 4) {
    $now = $now.AddMinutes(-($minuteInCycle - 4))
}

$stamp = $now.ToString("yyyyMMddHHmm") + "00"
$directory = Join-Path (Get-Location) "data/gdelt"
New-Item -ItemType Directory -Force -Path $directory | Out-Null

$ngrams = Join-Path $directory "$stamp.ngrams.txt.gz"
$toc = Join-Path $directory "$stamp.toc.json.gz"

curl.exe -fL --silent --show-error "$base/$stamp.ngrams.txt.gz" -o $ngrams
if ($LASTEXITCODE -ne 0) {
    throw "GDELT NGRAMS download failed for $stamp."
}

curl.exe -fL --silent --show-error "$base/$stamp.toc.json.gz" -o $toc
if ($LASTEXITCODE -ne 0) {
    Remove-Item $ngrams -Force -ErrorAction SilentlyContinue
    throw "GDELT TOC download failed for $stamp. Retry later; do not mix timestamps."
}

Write-Host "Downloaded matching GDELT snapshot: $stamp"
Write-Host "NGRAMS: $ngrams"
Write-Host "TOC:    $toc"
~~~

If the source has not published that pair yet, rerun the block a little later. Do not combine an NGRAMS file with a TOC file carrying a different timestamp. You do **not** need to unzip the files: the scanner reads both gzip files directly.

The source URLs are direct public data-file URLs, not API endpoints. The upstream server may still impose operational controls or become unavailable; this project does not claim unlimited bandwidth or service availability.

## Scan locally

From the Rewide repository root:

~~~powershell
$scanArgs = @(
  "--ngrams", ".\20261115180000.ngrams.txt.gz",
  "--toc", ".\20261115180000.toc.json.gz",
  "--query", "climate change",
  "--language", "en",
  "--limit", "100",
  "--output", ".\data\gdelt-candidates.ndjson"
)
node tools/gdelt-discovery/src/cli.js @scanArgs
~~~

Supported query length is one to four searchable words because the source contains quadgrams. Matching is case-insensitive, Unicode-normalized, punctuation-insensitive and phrase-aware. Candidate URLs are normalized, fragment-free, de-duplicated and ranked by matched occurrence count.

The tool outputs JSON Lines with source timestamp, URL, source title/date/language and match counts. It does not treat GDELT titles or snippets as fetched Rewide search results.

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
- GDELT's public data-file access is free, but no claim is made that the upstream host guarantees unlimited bandwidth, request rate or availability.
- Original publisher content remains subject to the publisher's rights and terms. This tool retains only candidate URL metadata and match counts; Rewide independently fetches pages and must continue honoring robots.txt and noindex.

## References

- https://blog.gdeltproject.org/using-the-new-web-ngrams-dataset-to-find-relevant-coverage/
- https://www.gdelt.org/data.html
