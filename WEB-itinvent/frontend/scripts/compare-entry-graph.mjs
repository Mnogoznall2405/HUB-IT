#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const normalize = (id) => {
  const posix = id.replace(/\\/g, '/');
  const nm = posix.indexOf('/node_modules/');
  if (nm >= 0) {
    return posix.slice(nm + '/node_modules/'.length);
  }
  const src = posix.indexOf('/frontend/src/');
  if (src >= 0) {
    return `src/${posix.slice(src + '/frontend/src/'.length)}`;
  }
  return posix;
};

const isVendor = (moduleId) => moduleId.includes('node_modules') || !moduleId.startsWith('src/');

const load = (path) => JSON.parse(readFileSync(path, 'utf8'));

const byModule = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const key = normalize(row.module);
    const current = map.get(key);
    if (!current || Number(row.renderedLength || 0) > Number(current.renderedLength || 0)) {
      map.set(key, row);
    }
  }
  return map;
};

const htmlEntryOf = (explicit, rows) => {
  if (explicit) {
    return explicit.replace(/\\/g, '/');
  }
  const entry = rows.find((row) => row.isEntry && /assets\/index-/.test(String(row.chunk || '')));
  return String(entry?.chunk || '');
};

const isInitial = (row, htmlEntry) => {
  if (!row) {
    return false;
  }
  const chunk = String(row.chunk || '').replace(/\\/g, '/');
  if (htmlEntry && chunk === htmlEntry) {
    return true;
  }
  if (htmlEntry && chunk.endsWith(`/${htmlEntry.split('/').pop()}`)) {
    return true;
  }
  return false;
};

const baselinePath = resolve(process.argv[2]);
const candidatePath = resolve(process.argv[3]);
const outPath = resolve(process.argv[4]);
const baselineHtmlEntry = process.argv[5] || '';
const candidateHtmlEntry = process.argv[6] || '';

const baselineRows = load(baselinePath);
const candidateRows = load(candidatePath);
const baseline = byModule(baselineRows);
const candidate = byModule(candidateRows);
const baselineEntry = htmlEntryOf(baselineHtmlEntry, baselineRows);
const candidateEntry = htmlEntryOf(candidateHtmlEntry, candidateRows);
const keys = new Set([...baseline.keys(), ...candidate.keys()]);
const rows = [];

for (const moduleId of [...keys].sort()) {
  const left = baseline.get(moduleId);
  const right = candidate.get(moduleId);
  const baselineChunk = left?.chunk || '';
  const candidateChunk = right?.chunk || '';
  const baselineInitial = isInitial(left, baselineEntry);
  const candidateInitial = isInitial(right, candidateEntry);
  if (baselineChunk === candidateChunk && baselineInitial === candidateInitial) {
    continue;
  }
  const size = Number(right?.renderedLength || left?.renderedLength || 0);
  let reason = 'chunk-changed';
  if (baselineInitial && !candidateInitial) {
    reason = 'left-html-entry';
  } else if (!baselineInitial && candidateInitial) {
    reason = isVendor(moduleId) ? 'vendor-entered-html-entry' : 'src-entered-html-entry';
  } else if (/recharts/i.test(baselineChunk) && !/recharts/i.test(String(candidateChunk))) {
    reason = 'left-recharts-manual-chunk';
  } else if (/emoji-picker/i.test(baselineChunk) && !/emoji-picker/i.test(String(candidateChunk))) {
    reason = 'left-emoji-manual-chunk';
  }
  rows.push({
    module: moduleId,
    baseline_chunk: baselineChunk,
    candidate_chunk: candidateChunk,
    baseline_in_initial: baselineInitial,
    candidate_in_initial: candidateInitial,
    decoded_size_estimate: size,
    reason,
  });
}

const header = [
  'module',
  'baseline_chunk',
  'candidate_chunk',
  'baseline_in_initial',
  'candidate_in_initial',
  'decoded_size_estimate',
  'reason',
];
const lines = [header.join(',')];
for (const row of rows) {
  lines.push(header.map((key) => JSON.stringify(row[key] ?? '')).join(','));
}
writeFileSync(outPath, `${lines.join('\n')}\n`);

const entered = rows.filter((r) => r.candidate_in_initial && !r.baseline_in_initial);
const left = rows.filter((r) => r.baseline_in_initial && !r.candidate_in_initial);
const enteredBytes = entered.reduce((sum, r) => sum + Number(r.decoded_size_estimate || 0), 0);
const leftBytes = left.reduce((sum, r) => sum + Number(r.decoded_size_estimate || 0), 0);
process.stdout.write(
  `baseline_html_entry=${baselineEntry} candidate_html_entry=${candidateEntry} changed_modules=${rows.length} entered_html_entry=${entered.length} entered_bytes=${enteredBytes} left_html_entry=${left.length} left_bytes=${leftBytes}\n`,
);
