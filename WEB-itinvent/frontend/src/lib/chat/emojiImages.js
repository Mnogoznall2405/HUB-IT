// R48: emoji are drawn as Apple images served by us (/emoji/apple/64/<unified>.png),
// never from an external CDN. This module is the pure part: it finds emoji in text and
// names their image files. The text itself is never changed - the <img> carries the real
// characters in `alt`, so copy/paste and search keep working.

const FE0F = '\uFE0F';

export const CHAT_EMOJI_SIZE_PX = 64;

export function getChatEmojiAssetBase() {
  const base = String(import.meta.env?.BASE_URL || '/');
  return `${base.endsWith('/') ? base : `${base}/`}emoji/apple/${CHAT_EMOJI_SIZE_PX}/`;
}

// Cheap pre-check: almost every message has no emoji, so the segmenter is skipped for them.
const POSSIBLE_EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]|\u20E3/u;
// Text-presentation symbols (©, ™, ↔ ...) stay text unless they carry U+FE0F or a ZWJ sequence.
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u;
const FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;

let graphemeSegmenter;
function getSegmenter() {
  if (graphemeSegmenter === undefined) {
    graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  }
  return graphemeSegmenter;
}

function isEmojiGrapheme(grapheme) {
  if (KEYCAP.test(grapheme) || FLAG.test(grapheme)) return true;
  if (!/\p{Extended_Pictographic}/u.test(grapheme)) return false;
  return EMOJI_PRESENTATION.test(grapheme) || grapheme.includes(FE0F) || grapheme.includes('\u200D');
}

export function containsEmoji(text) {
  return POSSIBLE_EMOJI.test(String(text || ''));
}

function graphemesOf(text) {
  const segmenter = getSegmenter();
  if (segmenter) return Array.from(segmenter.segment(text), (item) => item.segment);
  // No Intl.Segmenter: code points are good enough for single-code-point emoji.
  return Array.from(text);
}

// -> [{ type: 'text', value } | { type: 'emoji', value }] ; consecutive text is merged.
export function splitEmojiText(value) {
  const text = String(value ?? '');
  if (!text || !containsEmoji(text)) return text ? [{ type: 'text', value: text }] : [];
  const parts = [];
  let buffer = '';
  graphemesOf(text).forEach((grapheme) => {
    if (isEmojiGrapheme(grapheme)) {
      if (buffer) parts.push({ type: 'text', value: buffer });
      buffer = '';
      parts.push({ type: 'emoji', value: grapheme });
    } else {
      buffer += grapheme;
    }
  });
  if (buffer) parts.push({ type: 'text', value: buffer });
  return parts;
}

// Code points are lowercase hex padded to 4 digits (0031-fe0f-20e3 for the keycap 1), as in the package.
export function emojiToUnified(emoji) {
  return Array.from(String(emoji || ''), (char) => char.codePointAt(0).toString(16).padStart(4, '0')).join('-');
}

// File names in emoji-datasource-apple are the "fully qualified" sequence, which keeps U+FE0F
// where Unicode requires it. User text is not always qualified (and sometimes over-qualified),
// so the same emoji is tried with and without U+FE0F before falling back to the glyph.
export function emojiImageCandidates(emoji) {
  const text = String(emoji || '');
  if (!text) return [];
  const exact = emojiToUnified(text);
  const stripped = emojiToUnified(text.split(FE0F).join(''));
  const chars = Array.from(text.split(FE0F).join(''));
  const qualified = chars.length ? emojiToUnified(`${chars[0]}${FE0F}${chars.slice(1).join('')}`) : '';
  return Array.from(new Set([exact, stripped, qualified].filter(Boolean)));
}

export function emojiImageUrl(unified) {
  return `${getChatEmojiAssetBase()}${unified}.png`;
}
