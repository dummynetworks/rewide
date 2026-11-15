import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_QUERY_TOKENS = 4;
const DEFAULT_WORKER_ENDPOINT = 'https://rewide-machine.dummynet.workers.dev';
const SUSPICIOUS_HTML_ATTRIBUTE = /(?:%20|%09|%0a|%0d|%0b|%0c|\\+)(?:class|href|src|style|id|onclick|onerror)\\s*(?:=|%3d)/i;

async function* readLines(filePath) {
  const source = createReadStream(filePath);
  const input = filePath.toLowerCase().endsWith('.gz')
    ? source.pipe(createGunzip())
    : source;
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) yield line;
  } finally {
    lines.close();
  }
}

export function normalizeTokens(value) {
  if (typeof value !== 'string') return [];
  return value
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\\p{L}\\p{N}]+/gu) ?? [];
}

function matchesPhrase(quadgram, queryTokens) {
  const tokens = normalizeTokens(quadgram);
  if (queryTokens.length > tokens.length) return false;

  for (let start = 0; start <= tokens.length - queryTokens.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < queryTokens.length; offset += 1) {
      if (tokens[start + offset] !== queryTokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }

  return false;
}

/**
 * Validate and normalize a candidate URL without attempting to repair it.
 * A rejected URL is returned with a stable diagnostic reason.
 */
function normalizeCandidateUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { url: null, reason: 'url_not_string' };
  }
  if (value.length > 2048) {
    return { url: null, reason: 'url_too_long' };
  }
  if (/[\\u0000-\\u0020\\u007f]/u.test(value)) {
    return { url: null, reason: 'url_contains_whitespace_or_control' };
  }
  if (SUSPICIOUS_HTML_ATTRIBUTE.test(value)) {
    return { url: null, reason: 'embedded_html_attribute' };
  }

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { url: null, reason: 'unsupported_protocol' };
    }
    if (url.username || url.password) {
      return { url: null, reason: 'url_credentials_not_allowed' };
    }
    if (!url.hostname) {
      return { url: null, reason: 'url_missing_hostname' };
    }

    url.hash = '';
    return { url: url.href, reason: null };
  } catch {
    return { url: null, reason: 'malformed_url' };
  }
}

function getSourceTimestamp(filePath) {
  const match = String(filePath).match(/(\\d{14})/);
  if (!match) return null;

  const value = match[1];
  const iso = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8)
    + 'T' + value.slice(8, 10) + ':' + value.slice(10, 12) + ':' + value.slice(12, 14) + 'Z';
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function positiveInteger(value, fallback, maximum, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RangeError(name + ' must be an integer from 1 to ' + maximum + '.');
  }
  return parsed;
}

/**
 * Scan one GDELT Web NGrams quadgram snapshot.
 *
 * GDELT's NGRAMS file is tab-delimited DOCID / QUADGRAM / COUNT.
 * Its companion TOC is JSON Lines keyed by ID. DOCIDs are local to the pair.
 * This function reads local files only; it does not make network requests.
 */
export async function scanGdeltSnapshot({
  ngramsPath,
  tocPath,
  query,
  language,
  limit = DEFAULT_LIMIT,
} = {}) {
  if (typeof ngramsPath !== 'string' || !ngramsPath) {
    throw new TypeError('ngramsPath is required.');
  }
  if (typeof tocPath !== 'string' || !tocPath) {
    throw new TypeError('tocPath is required.');
  }

  const queryTokens = normalizeTokens(query);
  if (queryTokens.length === 0) {
    throw new TypeError('Query must contain at least one searchable word.');
  }
  if (queryTokens.length > MAX_QUERY_TOKENS) {
    throw new RangeError('GDELT quadgrams support phrases of up to four searchable words.');
  }

  const resultLimit = positiveInteger(limit, DEFAULT_LIMIT, MAX_LIMIT, 'limit');
  const requestedLanguage = typeof language === 'string' && language.trim()
    ? language.trim().toLowerCase()
    : null;

  const matches = new Map();
  let ngramRows = 0;
  let malformedNgramRows = 0;
  let matchedRows = 0;

  for await (const line of readLines(ngramsPath)) {
    if (!line.trim()) continue;
    ngramRows += 1;

    const columns = line.split('\\t');
    if (columns.length < 3) {
      malformedNgramRows += 1;
      continue;
    }

    const docId = Number(columns[0]);
    const count = Number(columns[2]);
    if (
      !Number.isSafeInteger(docId)
      || docId < 0
      || !Number.isFinite(count)
      || count < 0
      || !matchesPhrase(columns[1], queryTokens)
    ) {
      if (!Number.isSafeInteger(docId) || docId < 0 || !Number.isFinite(count) || count < 0) {
        malformedNgramRows += 1;
      }
      continue;
    }

    matchedRows += 1;
    const previous = matches.get(docId) ?? { occurrences: 0, matchedQuadgrams: 0 };
    previous.occurrences += count;
    previous.matchedQuadgrams += 1;
    matches.set(docId, previous);
  }

  const candidatesByUrl = new Map();
  const rejectedUrls = [];
  const rejectedUrlReasons = {};
  const remainingIds = new Set(matches.keys());
  let tocRows = 0;
  let malformedTocRows = 0;
  let invalidUrls = 0;

  for await (const line of readLines(tocPath)) {
    if (!line.trim()) continue;
    tocRows += 1;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      malformedTocRows += 1;
      continue;
    }

    const docId = Number(record?.ID);
    if (!Number.isSafeInteger(docId) || !matches.has(docId)) continue;

    remainingIds.delete(docId);

    if (
      requestedLanguage
      && String(record.lang ?? '').toLowerCase() !== requestedLanguage
    ) {
      continue;
    }

    const normalizedUrl = normalizeCandidateUrl(record.url);
    if (!normalizedUrl.url) {
      invalidUrls += 1;
      rejectedUrlReasons[normalizedUrl.reason] = (rejectedUrlReasons[normalizedUrl.reason] ?? 0) + 1;
      const originalUrl = typeof record.url === 'string' ? record.url : null;
      rejectedUrls.push({
        docId,
        title: typeof record.title === 'string' ? record.title.trim().slice(0, 500) : '',
        originalUrl: originalUrl === null ? null : originalUrl.slice(0, 4096),
        originalUrlTruncated: originalUrl !== null && originalUrl.length > 4096,
        reason: normalizedUrl.reason,
        gdeltRecordDate: typeof record.date === 'string' ? record.date : null,
      });
      continue;
    }

    const url = normalizedUrl.url;
    const match = matches.get(docId);
    const candidate = candidatesByUrl.get(url);
    if (candidate) {
      candidate.occurrences += match.occurrences;
      candidate.matchedQuadgrams += match.matchedQuadgrams;
      if (!candidate.title && typeof record.title === 'string') {
        candidate.title = record.title.slice(0, 500);
      }
    } else {
      candidatesByUrl.set(url, {
        schemaVersion: 2,
        source: 'gdelt-web-ngrams-quadgrams',
        sourceTimestamp: getSourceTimestamp(ngramsPath),
        gdeltRecordDate: typeof record.date === 'string' ? record.date : null,
        url,
        title: typeof record.title === 'string' ? record.title.trim().slice(0, 500) : '',
        language: typeof record.lang === 'string' ? record.lang : null,
        occurrences: match.occurrences,
        matchedQuadgrams: match.matchedQuadgrams,
      });
    }
  }

  const candidates = [...candidatesByUrl.values()]
    .sort((left, right) => (
      right.occurrences - left.occurrences
      || right.matchedQuadgrams - left.matchedQuadgrams
      || left.url.localeCompare(right.url)
    ))
    .slice(0, resultLimit);

  return {
    query: String(query).trim(),
    language: requestedLanguage,
    candidates,
    rejectedUrls,
    stats: {
      ngramRows,
      malformedNgramRows,
      matchedRows,
      matchedDocuments: matches.size,
      tocRows,
      malformedTocRows,
      invalidUrls,
      rejectedUrlRecords: rejectedUrls.length,
      rejectedUrlReasons,
      missingTocEntries: remainingIds.size,
      uniqueCandidates: candidatesByUrl.size,
      returnedCandidates: candidates.length,
    },
  };
}

function normalizeWorkerEndpoint(value) {
  try {
    const endpoint = new URL(value || DEFAULT_WORKER_ENDPOINT);
    if (
      endpoint.protocol !== 'https:'
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
    ) {
      return null;
    }
    return new URL('/v1/crawl', endpoint).href;
  } catch {
    return null;
  }
}

/**
 * Submit candidates to Rewide Machine one at a time.
 * This is an opt-in call to the user's own crawler, not to GDELT.
 */
export async function submitCandidates(candidates, {
  token,
  endpoint = DEFAULT_WORKER_ENDPOINT,
  fetcher = globalThis.fetch,
  delayMs = 1000,
  limit = 100,
} = {}) {
  if (typeof token !== 'string' || token.length < 24) {
    throw new TypeError('DUMMYNET_TOKEN must contain at least 24 characters.');
  }
  const target = normalizeWorkerEndpoint(endpoint);
  if (!target) throw new TypeError('Worker endpoint must be a valid HTTPS URL.');
  if (typeof fetcher !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new RangeError('delayMs must be an integer from 0 to 60000.');
  }

  const submissionLimit = positiveInteger(limit, 100, 1000, 'submit limit');
  const urls = [...new Set(
    (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => normalizeCandidateUrl(candidate?.url).url)
      .filter(Boolean),
  )].slice(0, submissionLimit);

  const outcomes = [];
  let stopped = false;

  for (let index = 0; index < urls.length; index += 1) {
    if (index > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const url = urls[index];
    try {
      const response = await fetcher(target, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url, maxPages: 1, maxDepth: 0 }),
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(15_000)
          : undefined,
      });
      const payload = await response.json().catch(() => null);
      const validPayload = payload !== null && typeof payload === 'object' && !Array.isArray(payload);

      if ((response.status === 200 || response.status === 202) && validPayload) {
        outcomes.push({
          url,
          status: typeof payload.status === 'string' ? payload.status : 'accepted',
          jobId: typeof payload.jobId === 'string' ? payload.jobId : null,
          error: null,
        });
      } else {
        outcomes.push({
          url,
          status: 'failed',
          jobId: null,
          error: validPayload && typeof payload.error === 'string'
            ? payload.error
            : 'HTTP_' + response.status,
        });
        if ([401, 403, 429, 503].includes(response.status)) {
          stopped = true;
          break;
        }
      }
    } catch (error) {
      outcomes.push({
        url,
        status: 'failed',
        jobId: null,
        error: error instanceof Error ? error.message : 'NETWORK_ERROR',
      });
      stopped = true;
      break;
    }
  }

  return {
    endpoint: target,
    requested: urls.length,
    submitted: outcomes.length,
    notSubmitted: urls.length - outcomes.length,
    stopped,
    outcomes,
  };
}
