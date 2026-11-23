// Native text/Markdown/CSV preview support: bounded allowlist of text-like
// formats, encoding-aware decoding and shared helpers for the viewers.
// These formats never go through ONLYOFFICE or LibreOffice.

export const TEXT_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const TEXT_PREVIEW_TRUNCATED_SUFFIX_LINES = 0;

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd']);
const CSV_EXTENSIONS = new Set(['csv', 'tsv']);

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'json', 'jsonl', 'ndjson', 'xml', 'xsd', 'xsl', 'xslt',
  'yaml', 'yml', 'ini', 'cfg', 'conf', 'config', 'properties', 'env', 'toml',
  'sql', 'py', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts',
  'css', 'scss', 'less', 'html', 'htm', 'vue', 'svelte',
  'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'php', 'rb',
  'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psm1',
  'diff', 'patch', 'gitignore', 'dockerignore', 'editorconfig',
]);

// Extension -> fast-path CodeMirror language key (dedicated packages).
// Everything else in TEXT_EXTENSIONS resolves through lazy legacy modes.
const LANGUAGE_BY_EXTENSION = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonl: 'json', ndjson: 'json',
  py: 'python', sql: 'sql',
  xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', svg: 'xml',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  yaml: 'yaml', yml: 'yaml',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown',
};

const TEXTUAL_MIME_PATTERNS = [
  /^text\//,
  /json/, /xml/, /javascript/, /ecmascript/, /x-yaml/, /yaml/,
  /toml/, /x-sh/, /x-python/, /x-httpd-php/, /x-perl/,
];

export const getTextFileExtension = (fileName = '') => {
  const normalized = String(fileName || '').toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex + 1) : '';
};

const isTextualMime = (contentType = '') => {
  const normalized = String(contentType || '').toLowerCase();
  return TEXTUAL_MIME_PATTERNS.some((pattern) => pattern.test(normalized));
};

/**
 * Classify a file into a native preview kind.
 * Returns 'markdown' | 'csv' | 'text' | '' (unsupported).
 */
export const getTextFileKind = ({ fileName = '', contentType = '' } = {}) => {
  const extension = getTextFileExtension(fileName);
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (CSV_EXTENSIONS.has(extension)) return 'csv';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  // MIME fallback only rescues extension-less names — a wrong text/* MIME
  // must not force arbitrary binary files into the text viewer.
  if (!extension && isTextualMime(contentType)) return 'text';
  return '';
};

/** CodeMirror language key for the fast-path packages; '' = plain text. */
export const getTextLanguage = (fileName = '') => (
  LANGUAGE_BY_EXTENSION[getTextFileExtension(fileName)] || ''
);

const isMarkdownFile = (fileName = '') => MARKDOWN_EXTENSIONS.has(getTextFileExtension(fileName));

/**
 * Decode a byte buffer into text. Detects BOMs first (UTF-8/UTF-16LE/BE),
 * then tries strict UTF-8 and falls back to Windows-1251 for legacy
 * Russian files. Returns { text, encoding }.
 */
export const decodeTextBuffer = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 BOM' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16 LE' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16 BE' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    try {
      return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'Windows-1251' };
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8' };
    }
  }
};

/**
 * Fetch up to maxBytes of a URL without loading the whole response into
 * memory. Cancels the body reader once the cap is reached.
 * Returns { buffer, truncated, totalBytes }.
 */
export const fetchTextWithLimit = async (url, { maxBytes = TEXT_PREVIEW_MAX_BYTES, signal } = {}) => {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const totalBytes = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader ? response.body.getReader() : null;
  if (!reader) {
    const full = await response.arrayBuffer();
    const buffer = full.byteLength > maxBytes ? full.slice(0, maxBytes) : full;
    return { buffer, truncated: full.byteLength > maxBytes, totalBytes: full.byteLength };
  }
  const chunks = [];
  let received = 0;
  let truncated = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength) {
      const remaining = maxBytes - received;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        received = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      received += value.byteLength;
      if (received >= maxBytes) {
        truncated = true;
        break;
      }
    }
  }
  if (truncated) {
    try { await reader.cancel(); } catch { /* stream already closed */ }
  } else {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { buffer, truncated, totalBytes };
};

import GithubSlugger from 'github-slugger';

/** GitHub heading anchor slug — the same algorithm rehype-slug applies. */
export const slugifyHeading = (text = '') => new GithubSlugger().slug(String(text || ''));

/**
 * Extract headings for the TOC. Skips fenced code blocks (``` and ~~~)
 * so '#' inside code samples is not treated as a heading.
 * Returns [{ level, text, slug }]; duplicate slugs get -1, -2, ... suffixes
 * the same way the renderer assigns them.
 */
export const extractMarkdownHeadings = (markdown = '', { maxLevel = 6 } = {}) => {
  const headings = [];
  const slugger = new GithubSlugger();
  let fence = '';
  for (const rawLine of String(markdown || '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] === '`' ? '```' : '~~~';
      if (!fence) fence = marker;
      else if (fence === marker) fence = '';
      continue;
    }
    if (fence) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1].length;
    if (level > maxLevel) continue;
    const text = match[2].replace(/[`*_[\]~\\]/g, '').trim();
    if (!text) continue;
    headings.push({ level, text, slug: slugger.slug(text) });
  }
  return headings;
};

/**
 * URL transform for react-markdown: allows http(s), mailto, tel, anchors
 * and relative paths; blocks javascript:, vbscript: and data: payloads.
 */
export const safeMarkdownUrlTransform = (url = '') => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('#')) return raw;
  // Whitespace/control chars can be used to obfuscate schemes ("java\tscript:").
  const value = raw.replace(/\s+/g, '');
  if (/^(https?:|mailto:|tel:)/i.test(value)) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
  return raw;
};

export const isMarkdownPreviewKind = (kind) => String(kind || '') === 'markdown';
export const isNativeTextKind = (kind) => ['text', 'markdown'].includes(String(kind || ''));
export { isMarkdownFile, MARKDOWN_EXTENSIONS, TEXT_EXTENSIONS, CSV_EXTENSIONS };
