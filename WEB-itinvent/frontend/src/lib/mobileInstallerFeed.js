export const MOBILE_INSTALLER_MANIFEST_PATH = '/desktop-updates/mobile/preview/latest.json';
export const MOBILE_INSTALLER_ROOT_PATH = '/desktop-updates/';
export const MOBILE_MANIFEST_MAX_BYTES = 16 * 1024;
export const MOBILE_APK_MAX_BYTES = 250 * 1024 * 1024;
export const MOBILE_MANIFEST_TIMEOUT_MS = 5_000;

const MANIFEST_V1_FIELDS = [
  'schema_version',
  'channel',
  'version',
  'published_at',
  'relative_path',
  'size_bytes',
  'sha256',
  'package_name',
  'min_sdk',
];
const MANIFEST_V2_FIELDS = [
  ...MANIFEST_V1_FIELDS,
  'version_code',
  'min_supported_version_code',
  'changelog',
  'signer_sha256',
];
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const PUBLISHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RELATIVE_PATH_PATTERN = /^mobile\/preview\/([0-9]+\.[0-9]+\.[0-9]+)\/HUB-IT-Mobile-Preview-([0-9]+\.[0-9]+\.[0-9]+)\.apk$/;
const PACKAGE_NAME = 'ru.zsgp.hubit.mobile';
const CACHE_TTL_MS = 60_000;
const DOWNLOAD_HOST = 'hubit.zsgp.ru';

let cachedFeed = null;
let cachedAt = 0;
let pendingFeed = null;

export class MobileInstallerFeedError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'MobileInstallerFeedError';
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
      || parsed.hostname.toLowerCase() !== DOWNLOAD_HOST
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

export function parseMobileInstallerManifest(value, { origin = getRuntimeOrigin() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MobileInstallerFeedError('manifest_schema');
  }
  const schemaVersion = Number(value.schema_version);
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new MobileInstallerFeedError('schema_version');
  }
  if (!hasExactFields(
    value,
    schemaVersion === 2 ? MANIFEST_V2_FIELDS : MANIFEST_V1_FIELDS,
  )) {
    throw new MobileInstallerFeedError('manifest_schema');
  }
  if (value.channel !== 'preview') throw new MobileInstallerFeedError('channel');
  if (!isBoundedText(value.version, 32) || !VERSION_PATTERN.test(value.version)) {
    throw new MobileInstallerFeedError('version');
  }
  if (
    !isBoundedText(value.published_at, 32)
    || !PUBLISHED_AT_PATTERN.test(value.published_at)
    || Number.isNaN(Date.parse(value.published_at))
  ) {
    throw new MobileInstallerFeedError('published_at');
  }
  if (!isBoundedText(value.relative_path, 512) || value.relative_path.includes('..') || value.relative_path.includes('\\')) {
    throw new MobileInstallerFeedError('relative_path');
  }
  const pathMatch = RELATIVE_PATH_PATTERN.exec(value.relative_path);
  if (!pathMatch || pathMatch[1] !== value.version || pathMatch[2] !== value.version) {
    throw new MobileInstallerFeedError('relative_path');
  }
  if (!Number.isSafeInteger(value.size_bytes) || value.size_bytes <= 0 || value.size_bytes > MOBILE_APK_MAX_BYTES) {
    throw new MobileInstallerFeedError('size_bytes');
  }
  if (!isBoundedText(value.sha256, 64) || !SHA256_PATTERN.test(value.sha256)) {
    throw new MobileInstallerFeedError('sha256');
  }
  if (value.package_name !== PACKAGE_NAME) throw new MobileInstallerFeedError('package_name');
  if (!Number.isSafeInteger(value.min_sdk) || value.min_sdk < 24 || value.min_sdk > 100) {
    throw new MobileInstallerFeedError('min_sdk');
  }

  let versionCode = null;
  let minSupportedVersionCode = null;
  let changelog = Object.freeze([]);
  let signerSha256 = null;
  if (schemaVersion === 2) {
    if (!Number.isSafeInteger(value.version_code) || value.version_code <= 0) {
      throw new MobileInstallerFeedError('version_code');
    }
    if (
      !Number.isSafeInteger(value.min_supported_version_code)
      || value.min_supported_version_code <= 0
      || value.min_supported_version_code > value.version_code
    ) {
      throw new MobileInstallerFeedError('min_supported_version_code');
    }
    if (
      !Array.isArray(value.changelog)
      || value.changelog.length < 1
      || value.changelog.length > 8
      || value.changelog.some((item) => !isBoundedText(item, 240))
    ) {
      throw new MobileInstallerFeedError('changelog');
    }
    if (!isBoundedText(value.signer_sha256, 64) || !SHA256_PATTERN.test(value.signer_sha256)) {
      throw new MobileInstallerFeedError('signer_sha256');
    }
    versionCode = value.version_code;
    minSupportedVersionCode = value.min_supported_version_code;
    changelog = Object.freeze(value.changelog.map((item) => item.trim()));
    signerSha256 = value.signer_sha256.toLowerCase();
  }

  const safeOrigin = normalizeOrigin(origin);
  if (!safeOrigin) throw new MobileInstallerFeedError('origin');
  const downloadUrl = new URL(`${MOBILE_INSTALLER_ROOT_PATH}${value.relative_path}`, `${safeOrigin}/`);
  if (
    downloadUrl.origin !== safeOrigin
    || !downloadUrl.pathname.startsWith('/desktop-updates/mobile/preview/')
    || downloadUrl.search
    || downloadUrl.hash
  ) {
    throw new MobileInstallerFeedError('relative_path');
  }

  return Object.freeze({
    schemaVersion,
    channel: 'preview',
    version: value.version,
    publishedAt: value.published_at,
    relativePath: value.relative_path,
    downloadUrl: downloadUrl.href,
    sizeBytes: value.size_bytes,
    sha256: value.sha256.toLowerCase(),
    packageName: value.package_name,
    minSdk: value.min_sdk,
    versionCode,
    minSupportedVersionCode,
    changelog,
    signerSha256,
  });
}

async function readTextWithinLimit(response, maximumBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new MobileInstallerFeedError('manifest_size');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new MobileInstallerFeedError('manifest_size');
  }
  return text;
}

export async function fetchMobileInstallerFeed({
  fetchImpl = globalThis.fetch,
  origin = getRuntimeOrigin(),
  timeoutMs = MOBILE_MANIFEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new MobileInstallerFeedError('fetch_unavailable');
  const safeOrigin = normalizeOrigin(origin);
  if (!safeOrigin) throw new MobileInstallerFeedError('origin');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const manifestUrl = new URL(MOBILE_INSTALLER_MANIFEST_PATH, `${safeOrigin}/`);
    const response = await fetchImpl(manifestUrl.href, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response?.ok || response.redirected) throw new MobileInstallerFeedError('manifest_http');
    const contentType = String(response.headers?.get?.('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') throw new MobileInstallerFeedError('manifest_content_type');
    const text = await readTextWithinLimit(response, MOBILE_MANIFEST_MAX_BYTES);
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new MobileInstallerFeedError('manifest_json');
    }
    return parseMobileInstallerManifest(value, { origin: safeOrigin });
  } catch (error) {
    if (error?.name === 'AbortError') throw new MobileInstallerFeedError('manifest_timeout');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function loadMobileInstallerFeed(options = {}) {
  const now = Date.now();
  if (!options.force && cachedFeed && now - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedFeed);
  }
  if (!options.force && pendingFeed) return pendingFeed;
  pendingFeed = fetchMobileInstallerFeed(options)
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

export function resetMobileInstallerFeedCacheForTests() {
  cachedFeed = null;
  cachedAt = 0;
  pendingFeed = null;
}

export function formatMobileInstallerSize(sizeBytes) {
  const value = Number(sizeBytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.round(value / (1024 * 1024))} МБ`;
}
