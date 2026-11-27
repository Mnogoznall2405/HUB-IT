#!/usr/bin/env node
// Generator: compact emoji keyword table from Unicode CLDR annotations
// (emojibase-data, locales en+ru) for the chat sticker search index and
// the composer `:keyword` emoji autocomplete.
//
// Usage:
//   node scripts/generate-emoji-keywords.mjs
//   (or `npm run generate:emoji-keywords`)
//
// Input:  node_modules/emojibase-data/{en,ru}/compact.json
// Output: src/lib/chat/generated/emojiKeywordData.js — deterministic
//         (no timestamps): regeneration after a dependency bump diffs
//         only real annotation changes. The output is meant to be
//         committed; the runtime never touches emojibase-data itself.
//
// Row format (one per line, TAB-separated):
//   <emoji><TAB><ru label><TAB><space-joined merged lowercase keywords>
// Keywords merge, per emoji: en tags, en label words, en label with
// underscores (Telegram-style `:thumbs_up`), ru tags, ru label words —
// deduped and sorted. Skin-tone variants are NOT emitted: the runtime
// forward lookup retries with modifiers stripped, and the autocomplete
// suggests base forms only. `order` is implicit (input arrays are sorted).

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(currentDir, '..');
const outFile = resolve(frontendDir, 'src', 'lib', 'chat', 'generated', 'emojiKeywordData.js');

const readJson = (relativePath) => JSON.parse(
  readFileSync(resolve(frontendDir, 'node_modules', relativePath), 'utf8'),
);

const packageJson = readJson('emojibase-data/package.json');
const enData = readJson('emojibase-data/en/compact.json');
const ruData = readJson('emojibase-data/ru/compact.json');

const ruByHexcode = new Map(ruData.map((entry) => [entry.hexcode, entry]));

// Multiword labels are searchable both per word and as one underscored
// token (`thumbs_up`) — Telegram shortcode parity.
const labelKeywords = (label) => {
  const words = String(label || '')
    .toLowerCase()
    .split(/[^0-9a-zа-яё]+/u)
    .filter((word) => word.length > 1 || /[a-zа-яё]/u.test(word));
  const underscored = String(label || '').trim().toLowerCase().replace(/\s+/g, '_');
  return underscored.includes('_') ? [...words, underscored] : words;
};

// U+FE0F variation selector — stripped by the runtime normalization.
const FE0F = '\uFE0F';

const rows = [];
const normOwner = new Map();
const collisionNotes = [];
let missingRu = 0;

enData.forEach((enEntry) => {
  const ruEntry = ruByHexcode.get(enEntry.hexcode);
  if (!ruEntry) missingRu += 1;
  const keywordSet = new Set();
  (enEntry.tags || []).forEach((tag) => keywordSet.add(String(tag).toLowerCase()));
  labelKeywords(enEntry.label).forEach((word) => keywordSet.add(word));
  if (ruEntry) {
    (ruEntry.tags || []).forEach((tag) => keywordSet.add(String(tag).toLowerCase()));
    labelKeywords(ruEntry.label).forEach((word) => keywordSet.add(word));
  }
  // The display label prefers RU (the app language); EN only as fallback.
  const label = String(ruEntry?.label || enEntry.label || '').trim();
  const emoji = String(enEntry.unicode || '').trim();
  if (!emoji) return;
  const keywords = Array.from(keywordSet).filter(Boolean).sort().join(' ');
  rows.push(`${emoji}\t${label}\t${keywords}`);
  // The runtime forward index keys rows by the FE0F-stripped form (same
  // normalization as sticker emoji); a collision would make lookup ambiguous.
  const norm = emoji.split(FE0F).join('');
  const owner = normOwner.get(norm);
  if (owner && owner !== enEntry.hexcode) {
    collisionNotes.push(`${owner} vs ${enEntry.hexcode} (norm ${norm.split('').map((c) => c.codePointAt(0).toString(16)).join('-')})`);
  } else {
    normOwner.set(norm, enEntry.hexcode);
  }
});

if (collisionNotes.length > 0) {
  throw new Error(`normalized emoji key collisions: ${collisionNotes.slice(0, 5).join('; ')}`);
}
if (missingRu > 0) {
  console.warn(`[generate-emoji-keywords] warning: ${missingRu} entries without ru annotation (en-only fallback)`);
}

const packed = rows.join('\n');

const banner = `// GENERATED FILE — do not edit by hand.
// Source: emojibase-data@${packageJson.version} (Unicode CLDR annotations, locales en+ru).
// Regenerate: \`npm run generate:emoji-keywords\` (scripts/generate-emoji-keywords.mjs).
// Rows: ${rows.length}. Format per line, TAB-separated:
//   <emoji>\\t<ru display label>\\t<space-joined merged lowercase keywords en+ru>
// Consumed by src/lib/chat/emojiKeywordIndex.js as a lazy chunk — keep it
// free of imports so the chunk stays data-only.
`;

const moduleSource = `${banner}
export const EMOJI_KEYWORD_DATA_META = ${JSON.stringify({
  source: `emojibase-data@${packageJson.version}`,
  locales: ['en', 'ru'],
  rows: rows.length,
})};

export const EMOJI_KEYWORD_ROWS = ${JSON.stringify(packed)};
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, moduleSource, 'utf8');

const bytes = Buffer.byteLength(moduleSource, 'utf8');
const packedBytes = Buffer.byteLength(packed, 'utf8');
console.log(`[generate-emoji-keywords] wrote ${outFile}`);
console.log(`[generate-emoji-keywords] rows=${rows.length} packed=${(packedBytes / 1024).toFixed(1)} KiB module=${(bytes / 1024).toFixed(1)} KiB`);
