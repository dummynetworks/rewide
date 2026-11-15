import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { normalizeTokens, scanGdeltSnapshot, submitCandidates } from '../tools/gdelt-discovery/src/index.js';
import { downloadLatestSnapshot } from '../tools/gdelt-discovery/src/downloader.js';

async function withSnapshot(run) {
  const directory = await mkdtemp(join(tmpdir(), 'rewide-gdelt-'));
  const ngramsPath = join(directory, '20260630201600.ngrams.txt.gz');
  const tocPath = join(directory, '20260630201600.toc.json.gz');

  const ngrams = [
    '1\tClimate change and communities\t3',
    '1\tclimate change impacts\t2',
    '2\tglobal warming has impact\t8',
    '3\tclimate change efforts\t4',
    '4\tclimate change affects local\t1',
    '5\tclimate change policy\tinvalid',
    'bad\tclimate change policy\t1',
  ].join('\n') + '\n';

  const toc = [
    JSON.stringify({
      ID: 1,
      date: '2026-06-30T20:16:00.000Z',
      lang: 'en',
      title: 'Climate change and communities',
      url: 'https://news.example/article#top',
    }),
    JSON.stringify({
      ID: 2,
      date: '2026-06-30T20:16:00.000Z',
      lang: 'en',
      title: 'Global warming',
      url: 'https://news.example/not-a-match',
    }),
    JSON.stringify({
      ID: 3,
      date: '2026-06-30T20:16:00.000Z',
      lang: 'en',
      title: 'Climate change efforts',
      url: 'https://news.example/article',
    }),
    JSON.stringify({
      ID: 4,
      date: '2026-06-30T20:16:00.000Z',
      lang: 'ko',
      title: '한국어 기사',
      url: 'https://news.example/korean',
    }),
  ].join('\n') + '\n';

  await Promise.all([
    writeFile(ngramsPath, gzipSync(ngrams)),
    writeFile(tocPath, gzipSync(toc)),
  ]);

  try {
    await run({ ngramsPath, tocPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('normalizes Unicode text and punctuation into searchable tokens', () => {
  assert.deepEqual(normalizeTokens('ＣＬＩＭＡＴＥ, change — 기후변화!'), [
    'climate',
    'change',
    '기후변화',
  ]);
});

test('scans the paired GDELT gzip files and de-duplicates normalized URLs', async () => {
  await withSnapshot(async ({ ngramsPath, tocPath }) => {
    const result = await scanGdeltSnapshot({
      ngramsPath,
      tocPath,
      query: 'climate change',
      limit: 10,
    });

    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0].url, 'https://news.example/article');
    assert.equal(result.candidates[0].occurrences, 9);
    assert.equal(result.candidates[0].matchedQuadgrams, 3);
    assert.equal(result.candidates[0].sourceTimestamp, '2026-06-30T20:16:00Z');
    assert.equal(result.candidates[0].schemaVersion, 2);
    assert.equal(result.candidates[0].gdeltRecordDate, '2026-06-30T20:16:00.000Z');
    assert.equal('sourceDate' in result.candidates[0], false);
    assert.equal(result.candidates[1].url, 'https://news.example/korean');
    assert.equal(result.stats.matchedDocuments, 3);
    assert.equal(result.stats.malformedNgramRows, 2);
  });
});

test('applies language filtering before returning candidates', async () => {
  await withSnapshot(async ({ ngramsPath, tocPath }) => {
    const result = await scanGdeltSnapshot({
      ngramsPath,
      tocPath,
      query: 'climate change',
      language: 'en',
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].language, 'en');
  });
});

test('rejects an empty query and phrases longer than four words', async () => {
  await withSnapshot(async ({ ngramsPath, tocPath }) => {
    await assert.rejects(
      scanGdeltSnapshot({ ngramsPath, tocPath, query: '***' }),
      /at least one searchable word/,
    );
    await assert.rejects(
      scanGdeltSnapshot({ ngramsPath, tocPath, query: 'one two three four five' }),
      /up to four searchable words/,
    );
  });
});

test('submits candidates sequentially and stops on an authentication or service error', async () => {
  const calls = [];
  const result = await submitCandidates([
    { url: 'https://news.example/one' },
    { url: 'https://news.example/two' },
    { url: 'https://news.example/three' },
  ], {
    token: 'test-crawler-token-that-is-at-least-24-chars',
    delayMs: 0,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          jobId: '00000000-0000-4000-8000-000000000041',
          status: 'queued',
        }), { status: 202 });
      }
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.submitted, 2);
  assert.equal(result.notSubmitted, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.outcomes[0].status, 'queued');
  assert.equal(result.outcomes[1].error, 'UNAUTHORIZED');
  assert.equal(calls[0].url, 'https://rewide-machine.dummynet.workers.dev/v1/crawl');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-crawler-token-that-is-at-least-24-chars');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    url: 'https://news.example/one',
    maxPages: 1,
    maxDepth: 0,
  });
});


test('downloads the newest available matching GDELT pair instead of guessing a timestamp', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rewide-gdelt-download-'));
  const requests = [];
  const ngramsBytes = gzipSync('1\tclimate change now\t4\n');
  const tocBytes = gzipSync(JSON.stringify({
    ID: 1,
    date: '2026-11-15T09:54:00.000Z',
    lang: 'en',
    title: 'Climate change now',
    url: 'https://news.example/climate',
  }) + '\n');

  try {
    const result = await downloadLatestSnapshot({
      directory,
      now: new Date('2026-11-15T10:00:30.000Z'),
      lookbackMinutes: 3,
      fetcher: async (url) => {
        requests.push(String(url));
        if (String(url).includes('20261115095500')) {
          return new Response(null, { status: 404 });
        }
        if (String(url).includes('20261115095400.ngrams')) {
          return new Response(ngramsBytes, { status: 200 });
        }
        if (String(url).includes('20261115095400.toc')) {
          return new Response(tocBytes, { status: 200 });
        }
        return new Response(null, { status: 404 });
      },
    });

    assert.equal(result.stamp, '20261115095400');
    assert.equal(result.attempts, 2);
    assert.equal(requests.length, 3);
    assert.deepEqual(await readFile(result.ngramsPath), ngramsBytes);
    assert.deepEqual(await readFile(result.tocPath), tocBytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stops probing when GDELT responds with a rate-limit or server error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rewide-gdelt-rate-limit-'));
  let requests = 0;

  try {
    await assert.rejects(
      downloadLatestSnapshot({
        directory,
        now: new Date('2026-11-15T10:00:30.000Z'),
        lookbackMinutes: 5,
        fetcher: async () => {
          requests += 1;
          return new Response(null, { status: 429 });
        },
      }),
      /HTTP 429/,
    );
    assert.equal(requests, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('rejects GDELT URLs contaminated with encoded HTML attributes without repairing them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rewide-gdelt-contaminated-url-'));
  const ngramsPath = join(directory, '20261115094700.ngrams.txt');
  const tocPath = join(directory, '20261115094700.toc.jsonl');
  const originalUrl = 'https://www.birgun.net/haber/example-746552%20class=';
  const recordDate = '2026-11-15T09:47:00.000Z';

  try {
    await writeFile(ngramsPath, '27\tclimate agenda today\t6\n', 'utf8');
    await writeFile(tocPath, JSON.stringify({
      ID: 27,
      date: recordDate,
      lang: 'en',
      title: 'The climate agenda',
      url: originalUrl,
    }) + '\n', 'utf8');

    const result = await scanGdeltSnapshot({
      ngramsPath,
      tocPath,
      query: 'climate',
      language: 'en',
    });

    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.rejectedUrls, [{
      docId: 27,
      title: 'The climate agenda',
      originalUrl,
      originalUrlTruncated: false,
      reason: 'embedded_html_attribute',
      gdeltRecordDate: recordDate,
    }]);
    assert.equal(result.stats.invalidUrls, 1);
    assert.equal(result.stats.rejectedUrlRecords, 1);
    assert.deepEqual(result.stats.rejectedUrlReasons, {
      embedded_html_attribute: 1,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not submit candidates whose URLs contain a suspicious HTML attribute', async () => {
  let requests = 0;
  const result = await submitCandidates([
    { url: 'https://news.example/article%20class=' },
  ], {
    token: 'test-crawler-token-that-is-at-least-24-chars',
    delayMs: 0,
    fetcher: async () => {
      requests += 1;
      return new Response(JSON.stringify({ status: 'queued' }), { status: 202 });
    },
  });

  assert.equal(requests, 0);
  assert.equal(result.requested, 0);
  assert.equal(result.submitted, 0);
  assert.equal(result.notSubmitted, 0);
});
