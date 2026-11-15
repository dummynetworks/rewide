#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import {
  access,
  mkdir,
  rename,
  rm,
} from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import * as pagefind from 'pagefind';

const DEFAULT_LIMIT = 10_000;
const MAX_LIMIT = 1_000_000;
const MAX_CONTENT_CHARS = 100_000;

const LANGUAGE_ALIASES = Object.freeze({
  eng: 'en',
  kor: 'ko',
  jpn: 'ja',
  chi: 'zh',
  zho: 'zh',
  fra: 'fr',
  fre: 'fr',
  deu: 'de',
  ger: 'de',
  spa: 'es',
  por: 'pt',
  rus: 'ru',
  ara: 'ar',
  hin: 'hi',
  ita: 'it',
  nld: 'nl',
  dut: 'nl',
  pol: 'pl',
  vie: 'vi',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  ces: 'cs',
  cze: 'cs',
  swe: 'sv',
  dan: 'da',
  nor: 'no',
  fin: 'fi',
  ell: 'el',
  gre: 'el',
  heb: 'he',
  ind: 'id',
  msa: 'ms',
  ron: 'ro',
  rum: 'ro',
});

function parseArguments(argv) {
  const options = {
    input: null,
    output: './dist/pagefind',
    limit: DEFAULT_LIMIT,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (!['--input', '--output', '--limit'].includes(argument)) {
      throw new Error('Unknown argument: ' + argument);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('Missing value for ' + argument);
    }

    index += 1;
    if (argument === '--input') options.input = value;
    if (argument === '--output') options.output = value;
    if (argument === '--limit') {
      const limit = Number(value);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new Error('--limit must be an integer from 1 to ' + MAX_LIMIT);
      }
      options.limit = limit;
    }
  }

  if (!options.help && !options.input) {
    throw new Error('Pass --input <file.ndjson> or --input - to read stdin.');
  }

  return options;
}

function normalizeLanguage(value) {
  if (typeof value !== 'string') return null;

  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  if (/^[a-z]{2}$/.test(language)) return language;
  return LANGUAGE_ALIASES[language] ?? null;
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || value.length > 4_096) return null;

  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || !url.hostname
    ) {
      return null;
    }

    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function isNoIndex(record) {
  return (
    record.indexable === false
    || record.indexable === 0
    || record.noIndex === true
    || record.noIndex === 1
    || record.no_index === true
    || record.no_index === 1
    || record.noindex_status === 'noindex'
  );
}

function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function toPagefindRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { skip: 'invalid-record' };
  }

  if (isNoIndex(record)) return { skip: 'noindex' };

  const url = normalizeUrl(record.url);
  if (!url) return { skip: 'invalid-url' };

  const language = normalizeLanguage(record.language);
  if (!language) return { skip: 'unsupported-language' };

  const title = cleanText(record.title, 500);
  const description = cleanText(record.description, 2_000);
  const body = cleanText(record.text ?? record.content, MAX_CONTENT_CHARS);
  const content = [title, description, body].filter(Boolean).join('\n\n');

  if (!content) return { skip: 'empty-content' };

  const fetchedAt = cleanText(
    record.fetchedAt ?? record.fetched_at ?? record.warc_date,
    64,
  );

  return {
    value: {
      url,
      content,
      language,
      meta: {
        title: title || url,
        description,
        fetched_at: fetchedAt,
      },
      filters: {
        language: [language],
      },
    },
  };
}

function helpText() {
  return [
    'Rewide Pagefind snapshot indexer',
    '',
    'Usage:',
    '  npm run build -- --input <documents.ndjson> --output <directory> [--limit <count>]',
    '  npm run build -- --input - --output <directory>',
    '',
    'Input is newline-delimited JSON. Each record must contain:',
    '  url, language, text',
    '',
    'Optional fields:',
    '  title, description, fetchedAt/fetched_at, indexable, noIndex/no_index',
    '',
    'Only indexable HTTP(S) records with a recognized ISO 639-1 language are indexed.',
    'The default maximum is 10,000 records per build.',
  ].join('\n');
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function replaceOutputDirectory(stagingPath, outputPath) {
  const backupPath = outputPath + '.backup-' + process.pid;
  await rm(backupPath, { recursive: true, force: true });

  const hadPreviousOutput = await pathExists(outputPath);
  if (hadPreviousOutput) {
    await rename(outputPath, backupPath);
  }

  try {
    await rename(stagingPath, outputPath);
  } catch (error) {
    if (hadPreviousOutput && await pathExists(backupPath)) {
      await rename(backupPath, outputPath);
    }
    throw error;
  }

  await rm(backupPath, { recursive: true, force: true });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText() + '\n');
    return;
  }

  const inputPath = options.input === '-' ? null : resolve(options.input);
  const outputPath = resolve(options.output);
  const stagingPath = outputPath + '.staging-' + process.pid;

  if (inputPath && inputPath === outputPath) {
    throw new Error('Input and output paths must be different.');
  }
  if (outputPath === dirname(outputPath)) {
    throw new Error('Refusing to replace a filesystem root directory.');
  }

  const input = inputPath ? createReadStream(inputPath) : process.stdin;
  const lines = createInterface({ input, crlfDelay: Infinity });

  const stats = {
    lines: 0,
    indexed: 0,
    duplicates: 0,
    invalidJson: 0,
    skippedNoindex: 0,
    skippedInvalidUrl: 0,
    skippedLanguage: 0,
    skippedEmpty: 0,
    skippedOther: 0,
  };

  const seenUrls = new Set();
  let index = null;

  try {
    const created = await pagefind.createIndex({ verbose: false });
    index = created.index;
    if (!index) throw new Error('Pagefind did not return an index instance.');

    for await (const line of lines) {
      if (!line.trim()) continue;
      stats.lines += 1;

      let record;
      try {
        record = JSON.parse(line);
      } catch {
        stats.invalidJson += 1;
        continue;
      }

      const converted = toPagefindRecord(record);
      if (converted.skip) {
        if (converted.skip === 'noindex') stats.skippedNoindex += 1;
        else if (converted.skip === 'invalid-url') stats.skippedInvalidUrl += 1;
        else if (converted.skip === 'unsupported-language') stats.skippedLanguage += 1;
        else if (converted.skip === 'empty-content') stats.skippedEmpty += 1;
        else stats.skippedOther += 1;
        continue;
      }

      const value = converted.value;
      if (seenUrls.has(value.url)) {
        stats.duplicates += 1;
        continue;
      }

      seenUrls.add(value.url);
      const result = await index.addCustomRecord(value);
      if (Array.isArray(result?.errors) && result.errors.length > 0) {
        throw new Error(
          'Pagefind rejected ' + value.url + ': ' + result.errors.join('; '),
        );
      }

      stats.indexed += 1;
      if (stats.indexed >= options.limit) break;

      if (stats.indexed % 1_000 === 0) {
        process.stderr.write('Indexed ' + stats.indexed + ' documents\n');
      }
    }

    if (stats.indexed === 0) {
      throw new Error('No eligible documents were found; refusing to write an empty index.');
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await rm(stagingPath, { recursive: true, force: true });

    const written = await index.writeFiles({ outputPath: stagingPath });
    if (Array.isArray(written?.errors) && written.errors.length > 0) {
      throw new Error('Pagefind failed to write the index: ' + written.errors.join('; '));
    }

    await replaceOutputDirectory(stagingPath, outputPath);

    process.stdout.write(JSON.stringify({
      ok: true,
      output: outputPath,
      limit: options.limit,
      ...stats,
    }, null, 2) + '\n');
  } finally {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    if (index && typeof index.deleteIndex === 'function') {
      await index.deleteIndex().catch(() => {});
    }
    await pagefind.close().catch(() => {});
    if (inputPath) input.destroy();
  }
}

main().catch((error) => {
  process.stderr.write(
    '[rewide-pagefind-indexer] ' + (error instanceof Error ? error.message : String(error)) + '\n',
  );
  process.exitCode = 1;
});
