#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanGdeltSnapshot, submitCandidates } from './index.js';
import { downloadLatestSnapshot } from './downloader.js';

function usage() {
  return [
    'Usage:',
    '  node tools/gdelt-discovery/src/cli.js --ngrams FILE --toc FILE --query TEXT [options]',
    '',
    'Options:',
    '  --language CODE       Optional GDELT language code, e.g. en or ko',
    '  --limit NUMBER        Maximum candidate URLs (default: 100, max: 1000)',
    '  --output FILE         Write candidate JSONL to a file (default: stdout)',
    '  --latest              Find and download the newest complete GDELT file pair',
    '  --data-dir DIRECTORY  Download directory for --latest (default: data/gdelt)',
    '  --lookback-minutes N  Search recent timestamps (default: 30, max: 180)',
    '  --submit              Submit candidates to the configured Rewide Machine Worker',
    '  --submit-limit NUMBER Maximum submissions (default: 100, max: 1000)',
    '  --delay-ms NUMBER     Delay between Worker submissions (default: 1000)',
    '  --endpoint URL        Rewide Machine HTTPS base URL',
    '  --help                Show this help',
    '',
    'The scanner reads local files only. It does not call GDELT APIs or download data.',
  ].join('\n') + '\n';
}

function readOptions(args) {
  const options = {};
  const valueOptions = new Set([
    '--ngrams',
    '--toc',
    '--data-dir',
    '--lookback-minutes',
    '--query',
    '--language',
    '--limit',
    '--output',
    '--submit-limit',
    '--delay-ms',
    '--endpoint',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--help') {
      options.help = true;
      continue;
    }
    if (key === '--latest') {
      options.latest = true;
      continue;
    }
    if (key === '--submit') {
      options.submit = true;
      continue;
    }
    if (!valueOptions.has(key) || index + 1 >= args.length) {
      throw new Error('Unknown option or missing value: ' + key);
    }
    options[key.slice(2).replaceAll('-', '_')] = args[++index];
  }

  return options;
}

function parseNumber(value, fallback, name, minimum, maximum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  }
  return parsed;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.query) {
    throw new Error('--query is required.');
  }

  let ngramsPath = options.ngrams ? resolve(options.ngrams) : null;
  let tocPath = options.toc ? resolve(options.toc) : null;

  if (options.latest) {
    if (ngramsPath || tocPath) {
      throw new Error('Use --latest or provide --ngrams and --toc, not both.');
    }

    const downloaded = await downloadLatestSnapshot({
      directory: resolve(options.data_dir ?? 'data/gdelt'),
      lookbackMinutes: parseNumber(options.lookback_minutes, 30, 'lookback-minutes', 1, 180),
    });
    ngramsPath = downloaded.ngramsPath;
    tocPath = downloaded.tocPath;
    process.stderr.write(
      'Downloaded ' + downloaded.source + ' snapshot ' + downloaded.stamp
      + ' after ' + downloaded.attempts + ' timestamp attempt(s).\\n',
    );
  } else if (!ngramsPath || !tocPath) {
    throw new Error('Provide both --ngrams and --toc, or use --latest.');
  }

  const result = await scanGdeltSnapshot({
    ngramsPath,
    tocPath,
    query: options.query,
    language: options.language,
    limit: parseNumber(options.limit, 100, 'limit', 1, 1000),
  });

  const jsonl = result.candidates.map((candidate) => JSON.stringify(candidate)).join('\n');
  const output = jsonl ? jsonl + '\n' : '';

  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, 'utf8');
    process.stderr.write('Candidates written: ' + outputPath + '\n');
  } else {
    process.stdout.write(output);
  }

  process.stderr.write('Scan summary: ' + JSON.stringify(result.stats) + '\n');

  if (!options.submit) return;

  const token = process.env.DUMMYNET_TOKEN;
  const submission = await submitCandidates(result.candidates, {
    token,
    endpoint: options.endpoint,
    limit: parseNumber(options.submit_limit, 100, 'submit-limit', 1, 1000),
    delayMs: parseNumber(options.delay_ms, 1000, 'delay-ms', 0, 60_000),
  });

  process.stderr.write('Worker submission summary: ' + JSON.stringify({
    endpoint: submission.endpoint,
    requested: submission.requested,
    submitted: submission.submitted,
    notSubmitted: submission.notSubmitted,
    stopped: submission.stopped,
    outcomes: submission.outcomes,
  }, null, 2) + '\n');

  if (submission.outcomes.some((item) => item.status === 'failed')) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write('GDELT discovery failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.stderr.write(usage());
    process.exitCode = 1;
  });
}
