import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { normalizeTokens, scanGdeltSnapshot, submitCandidates } from '../tools/gdelt-discovery/src/index.js';

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
