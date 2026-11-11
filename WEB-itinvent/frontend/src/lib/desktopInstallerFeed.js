export const DESKTOP_UPDATE_MANIFEST_PATH = '/desktop-updates/stable/latest.json';
export const DESKTOP_UPDATE_ROOT_PATH = '/desktop-updates/';
export const DESKTOP_MANIFEST_MAX_BYTES = 32 * 1024;
export const DESKTOP_SETUP_MAX_BYTES = 500 * 1024 * 1024;
export const DESKTOP_MANIFEST_TIMEOUT_MS = 5_000;

const ROOT_FIELDS = [
  'schema_version',
  'channel',
  'version',
  'published_at',
  'relative_path',
  'size_bytes',
  'sha256',
  'release_notes',
  'signature',
];
const SIGNATURE_FIELDS = ['algorithm', 'key_id', 'value'];
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const PUBLISHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RELATIVE_PATH_PATTERN = /^stable\/([0-9]+\.[0-9]+\.[0-9]+)\/HUB-Desktop-Setup-([0-9]+\.[0-9]+\.[0-9]+)-win-x64\.exe$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CACHE_TTL_MS = 60_000;
const DESKTOP_DOWNLOAD_HOST = 'hubit.zsgp.ru';

let cachedFeed = null;
let cachedAt = 0;
let pendingFeed = null;

export class DesktopInstallerFeedError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'DesktopInstallerFeedError';
    this.code = code;
  }
}

function hasExactFields(value, expectedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function isBoundedText(value, maximumLength) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function normalizeOrigin(origin) {
  try {
    const parsed = new URL(String(origin || ''));
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname.toLowerCase() !== DESKTOP_DOWNLOAD_HOST
      || parsed.port
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      return '';
    }
    return parsed.origin;
  } catch {
    return '';
  }
}

function getRuntimeOrigin() {
  if (typeof window === 'undefined') return '';
  return normalizeOrigin(window.location.origin);
}

export function parseDesktopInstallerManifest(value, { origin = getRuntimeOrigin() } = {}) {
  if (!hasExactFields(value, ROOT_FIELDS)) {
    throw new DesktopInstallerFeedError('manifest_schema');
  }
  if (value.schema_version !== 1) {
    throw new DesktopInstallerFeedError('schema_version');
  }
  if (value.channel !== 'stable') {
    throw new DesktopInstallerFeedError('channel');
  }
  if (!isBoundedText(value.version, 32) || !VERSION_PATTERN.test(value.version)) {
    throw new DesktopInstallerFeedError('version');
  }
  if (
    !isBoundedText(value.published_at, 32)
    || !PUBLISHED_AT_PATTERN.test(value.published_at)
    || Number.isNaN(Date.parse(value.published_at))
  ) {
    throw new DesktopInstallerFeedError('published_at');
  }

  if (!isBoundedText(value.relative_path, 512) || value.relative_path.includes('..') || value.relative_path.includes('\\')) {
    throw new DesktopInstallerFeedError('relative_path');
  }
  const pathMatch = RELATIVE_PATH_PATTERN.exec(value.relative_path);
  if (!pathMatch || pathMatch[1] !== value.version || pathMatch[2] !== value.version) {
    throw new DesktopInstallerFeedError('relative_path');
  }

  if (
    !Number.isSafeInteger(value.size_bytes)
    || value.size_bytes <= 0
    || value.size_bytes > DESKTOP_SETUP_MAX_BYTES
  ) {
    throw new DesktopInstallerFeedError('size_bytes');
  }
  if (!isBoundedText(value.sha256, 64) || !SHA256_PATTERN.test(value.sha256)) {
    throw new DesktopInstallerFeedError('sha256');
  }
  if (
    !Array.isArray(value.release_notes)
    || value.release_notes.length > 10
    || value.release_notes.some((note) => !isBoundedText(note, 200))
  ) {
    throw new DesktopInstallerFeedError('release_notes');
  }
  if (
    !hasExactFields(value.signature, SIGNATURE_FIELDS)
    || value.signature.algorithm !== 'RSA-PSS-SHA256'
    || !isBoundedText(value.signature.key_id, 64)
    || !KEY_ID_PATTERN.test(value.signature.key_id)
    || !isBoundedText(value.signature.value, 2048)
    || !BASE64_PATTERN.test(value.signature.value)
  ) {
    throw new DesktopInstallerFeedError('signature');
  }

  const safeOrigin = normalizeOrigin(origin);
  if (!safeOrigin) {
    throw new DesktopInstallerFeedError('origin');
  }
  const downloadUrl = new URL(`${DESKTOP_UPDATE_ROOT_PATH}${value.relative_path}`, `${safeOrigin}/`);
  if (
    downloadUrl.origin !== safeOrigin
    || !downloadUrl.pathname.startsWith('/desktop-updates/stable/')
    || downloadUrl.search
    || downloadUrl.hash
  ) {
    throw new DesktopInstallerFeedError('relative_path');
  }

  return Object.freeze({
    schemaVersion: 1,
    channel: 'stable',
    version: value.version,
    publishedAt: value.published_at,
    relativePath: value.relative_path,
    downloadUrl: downloadUrl.href,
    sizeBytes: value.size_bytes,
    sha256: value.sha256.toLowerCase(),
    releaseNotes: Object.freeze([...value.release_notes]),
  });
}

async function readTextWithinLimit(response, maximumBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new DesktopInstallerFeedError('manifest_size');
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw new DesktopInstallerFeedError('manifest_size');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new DesktopInstallerFeedError('manifest_size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder('utf-8', { fatal: true }).decode(merged);
}

export async function fetchDesktopInstallerFeed({
  fetchImpl = globalThis.fetch,
  origin = getRuntimeOrigin(),
  timeoutMs = DESKTOP_MANIFEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new DesktopInstallerFeedError('fetch_unavailable');
  }
  const safeOrigin = normalizeOrigin(origin);
  if (!safeOrigin) {
    throw new DesktopInstallerFeedError('origin');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const manifestUrl = new URL(DESKTOP_UPDATE_MANIFEST_PATH, `${safeOrigin}/`);
    const response = await fetchImpl(manifestUrl.href, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response?.ok || response.redirected) {
      throw new DesktopInstallerFeedError('manifest_http');
    }
    const contentType = String(response.headers?.get?.('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      throw new DesktopInstallerFeedError('manifest_content_type');
    }
    const text = await readTextWithinLimit(response, DESKTOP_MANIFEST_MAX_BYTES);
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new DesktopInstallerFeedError('manifest_json');
    }
    return parseDesktopInstallerManifest(value, { origin: safeOrigin });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new DesktopInstallerFeedError('manifest_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function loadDesktopInstallerFeed(options = {}) {
  const now = Date.now();
  if (!options.force && cachedFeed && now - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedFeed);
  }
  if (!options.force && pendingFeed) return pendingFeed;

  pendingFeed = fetchDesktopInstallerFeed(options)
    .then((feed) => {
      cachedFeed = feed;
      cachedAt = Date.now();
      return feed;
    })
    .finally(() => {
      pendingFeed = null;
    });
  return pendingFeed;
}

export function resetDesktopInstallerFeedCacheForTests() {
  cachedFeed = null;
  cachedAt = 0;
  pendingFeed = null;
}

export function formatInstallerSize(sizeBytes) {
  const value = Number(sizeBytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.round(value / (1024 * 1024))} МБ`;
}

export function detectDesktopDownloadPlatform(navigatorLike = globalThis.navigator) {
  const userAgent = String(navigatorLike?.userAgent || '');
  const platform = String(navigatorLike?.userAgentData?.platform || navigatorLike?.platform || '');
  const mobile = Boolean(navigatorLike?.userAgentData?.mobile)
    || /android|iphone|ipad|ipod|mobile/i.test(userAgent);
  const windows = /windows|win32|win64/i.test(`${platform} ${userAgent}`);
  return Object.freeze({ windows, mobile, supported: windows && !mobile });
}
