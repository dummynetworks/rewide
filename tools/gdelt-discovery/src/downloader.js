import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE_URL = 'https://data.gdeltproject.org/gdeltv5/weblegacy/ngrams';
const DEFAULT_LOOKBACK_MINUTES = 30;
const MAX_LOOKBACK_MINUTES = 180;
const REQUEST_TIMEOUT_MS = 90_000;

function minuteStamp(date) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

async function removeQuietly(path) {
  await rm(path, { force: true }).catch(() => {});
}

async function writeResponse(response, destination) {
  if (!response.body) {
    throw new Error('GDELT returned an empty response body.');
  }

  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  );

  const file = await stat(destination);
  if (file.size === 0) {
    await removeQuietly(destination);
    throw new Error('GDELT returned an empty data file.');
  }
}

async function getFile(fetcher, url) {
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { accept: 'application/gzip, application/octet-stream' },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined,
    });
  } catch (error) {
    throw new Error(
      'GDELT download request failed: ' + (error instanceof Error ? error.message : String(error)),
    );
  }

  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('GDELT returned HTTP ' + response.status + ' for ' + url);
  }

  return response;
}

/**
 * Find and download the newest complete NGRAMS/TOC pair.
 *
 * GDELT publishes minute-stamped files in short bursts around its 15-minute
 * processing heartbeat. Probe recent timestamps newest-first instead of
 * assuming a particular minute in the burst must exist.
 */
export async function downloadLatestSnapshot({
  directory = 'data/gdelt',
  lookbackMinutes = DEFAULT_LOOKBACK_MINUTES,
  now = new Date(),
  fetcher = globalThis.fetch,
} = {}) {
  if (typeof directory !== 'string' || !directory) {
    throw new TypeError('A download directory is required.');
  }
  if (
    !Number.isInteger(lookbackMinutes)
    || lookbackMinutes < 1
    || lookbackMinutes > MAX_LOOKBACK_MINUTES
  ) {
    throw new RangeError('lookbackMinutes must be an integer from 1 to ' + MAX_LOOKBACK_MINUTES + '.');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date.');
  }
  if (typeof fetcher !== 'function') {
    throw new TypeError('A fetch implementation is required.');
  }

  const outputDirectory = directory;
  await mkdir(outputDirectory, { recursive: true });

  const currentMinute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const firstMinute = new Date(currentMinute.getTime() - 5 * 60_000);

  for (let offset = 0; offset <= lookbackMinutes; offset += 1) {
    const candidate = new Date(firstMinute.getTime() - offset * 60_000);
    const stamp = minuteStamp(candidate);
    const ngramsPath = join(outputDirectory, stamp + '.ngrams.txt.gz');
    const tocPath = join(outputDirectory, stamp + '.toc.json.gz');
    const ngramsTemp = ngramsPath + '.part';
    const tocTemp = tocPath + '.part';

    await Promise.all([
      removeQuietly(ngramsPath),
      removeQuietly(tocPath),
      removeQuietly(ngramsTemp),
      removeQuietly(tocTemp),
    ]);

    const ngramsUrl = BASE_URL + '/' + stamp + '.ngrams.txt.gz';
    const ngramsResponse = await getFile(fetcher, ngramsUrl);
    if (!ngramsResponse) continue;

    try {
      await writeResponse(ngramsResponse, ngramsTemp);
    } catch (error) {
      await removeQuietly(ngramsTemp);
      throw error;
    }

    const tocUrl = BASE_URL + '/' + stamp + '.toc.json.gz';
    let tocResponse;
    try {
      tocResponse = await getFile(fetcher, tocUrl);
    } catch (error) {
      await removeQuietly(ngramsTemp);
      throw error;
    }
    if (!tocResponse) {
      await removeQuietly(ngramsTemp);
      continue;
    }

    try {
      await writeResponse(tocResponse, tocTemp);
      await rename(ngramsTemp, ngramsPath);
      await rename(tocTemp, tocPath);
    } catch (error) {
      await Promise.all([removeQuietly(ngramsTemp), removeQuietly(tocTemp)]);
      throw error;
    }

    return {
      stamp,
      ngramsPath,
      tocPath,
      attempts: offset + 1,
      source: 'GDELT Web NGrams quadgrams',
    };
  }

  throw new Error(
    'No complete GDELT NGRAMS/TOC pair was found in the searched window. '
    + 'The source publishes in bursts; try again later or increase --lookback-minutes.',
  );
}
