import { HUB_WEB_ORIGIN } from '../api/config';

export const MOBILE_UPDATE_MANIFEST_PATH = '/desktop-updates/mobile/preview/latest.json';
export const MOBILE_UPDATE_PACKAGE_NAME = 'ru.zsgp.hubit.mobile';
export const MOBILE_UPDATE_MANIFEST_MAX_BYTES = 16 * 1024;
export const MOBILE_UPDATE_APK_MAX_BYTES = 250 * 1024 * 1024;
export const MOBILE_UPDATE_TIMEOUT_MS = 8_000;

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
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const PUBLISHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RELATIVE_PATH_PATTERN = /^mobile\/preview\/([0-9]+\.[0-9]+\.[0-9]+)\/HUB-IT-Mobile-Preview-([0-9]+\.[0-9]+\.[0-9]+)\.apk$/;

export type MobileUpdateFeed = Readonly<{
  schemaVersion: 1 | 2;
  channel: 'preview';
  version: string;
  publishedAt: string;
  relativePath: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string;
  packageName: typeof MOBILE_UPDATE_PACKAGE_NAME;
  minSdk: number;
  versionCode: number | null;
  minSupportedVersionCode: number | null;
  changelog: readonly string[];
  signerSha256: string | null;
}>;

export class MobileUpdateError extends Error {
  code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'MobileUpdateError';
    this.code = code;
  }
}

function normalizeUpdateOrigin(origin: string): string {
  try {
    const parsed = new URL(String(origin || '').trim());
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname.toLowerCase() !== 'hubit.zsgp.ru'
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

function hasExactFields(value: Record<string, unknown>, expectedFields: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function parseMobileUpdateManifest(
  value: unknown,
  { origin = HUB_WEB_ORIGIN }: { origin?: string } = {},
): MobileUpdateFeed {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MobileUpdateError('manifest_schema');
  }
  const manifest = value as Record<string, unknown>;
  const schemaVersion = Number(manifest.schema_version);
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new MobileUpdateError('schema_version');
  if (!hasExactFields(
    manifest,
    schemaVersion === 2 ? MANIFEST_V2_FIELDS : MANIFEST_V1_FIELDS,
  )) throw new MobileUpdateError('manifest_schema');
  if (manifest.channel !== 'preview') throw new MobileUpdateError('channel');
  if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) {
    throw new MobileUpdateError('version');
  }
  if (
    typeof manifest.published_at !== 'string'
    || !PUBLISHED_AT_PATTERN.test(manifest.published_at)
    || Number.isNaN(Date.parse(manifest.published_at))
  ) {
    throw new MobileUpdateError('published_at');
  }
  if (typeof manifest.relative_path !== 'string' || manifest.relative_path.length > 512) {
    throw new MobileUpdateError('relative_path');
  }
  const pathMatch = RELATIVE_PATH_PATTERN.exec(manifest.relative_path);
  if (!pathMatch || pathMatch[1] !== manifest.version || pathMatch[2] !== manifest.version) {
    throw new MobileUpdateError('relative_path');
  }
  if (
    !Number.isSafeInteger(manifest.size_bytes)
    || Number(manifest.size_bytes) <= 0
    || Number(manifest.size_bytes) > MOBILE_UPDATE_APK_MAX_BYTES
  ) {
    throw new MobileUpdateError('size_bytes');
  }
  if (typeof manifest.sha256 !== 'string' || !SHA256_PATTERN.test(manifest.sha256)) {
    throw new MobileUpdateError('sha256');
  }
  if (manifest.package_name !== MOBILE_UPDATE_PACKAGE_NAME) {
    throw new MobileUpdateError('package_name');
  }
  if (!Number.isSafeInteger(manifest.min_sdk) || Number(manifest.min_sdk) < 24 || Number(manifest.min_sdk) > 100) {
    throw new MobileUpdateError('min_sdk');
  }

  let versionCode: number | null = null;
  let minSupportedVersionCode: number | null = null;
  let changelog: readonly string[] = [];
  let signerSha256: string | null = null;
  if (schemaVersion === 2) {
    if (!Number.isSafeInteger(manifest.version_code) || Number(manifest.version_code) <= 0) {
      throw new MobileUpdateError('version_code');
    }
    if (
      !Number.isSafeInteger(manifest.min_supported_version_code)
      || Number(manifest.min_supported_version_code) <= 0
      || Number(manifest.min_supported_version_code) > Number(manifest.version_code)
    ) {
      throw new MobileUpdateError('min_supported_version_code');
    }
    if (
      !Array.isArray(manifest.changelog)
      || manifest.changelog.length < 1
      || manifest.changelog.length > 8
      || manifest.changelog.some((item) => (
        typeof item !== 'string'
        || item.trim().length < 1
        || item.trim().length > 240
        || /[\u0000-\u001f\u007f]/.test(item)
      ))
    ) {
      throw new MobileUpdateError('changelog');
    }
    if (typeof manifest.signer_sha256 !== 'string' || !SHA256_PATTERN.test(manifest.signer_sha256)) {
      throw new MobileUpdateError('signer_sha256');
    }
    versionCode = Number(manifest.version_code);
    minSupportedVersionCode = Number(manifest.min_supported_version_code);
    changelog = Object.freeze(manifest.changelog.map((item) => String(item).trim()));
    signerSha256 = manifest.signer_sha256.toLowerCase();
  }

  const safeOrigin = normalizeUpdateOrigin(origin);
  if (!safeOrigin) throw new MobileUpdateError('origin');
  const downloadUrl = new URL(`/desktop-updates/${manifest.relative_path}`, `${safeOrigin}/`);
  if (
    downloadUrl.origin !== safeOrigin
    || !downloadUrl.pathname.startsWith('/desktop-updates/mobile/preview/')
    || downloadUrl.search
    || downloadUrl.hash
  ) {
    throw new MobileUpdateError('relative_path');
  }

  return Object.freeze({
    schemaVersion,
    channel: 'preview',
    version: manifest.version,
    publishedAt: manifest.published_at,
    relativePath: manifest.relative_path,
    downloadUrl: downloadUrl.href,
    sizeBytes: Number(manifest.size_bytes),
    sha256: manifest.sha256.toLowerCase(),
    packageName: MOBILE_UPDATE_PACKAGE_NAME,
    minSdk: Number(manifest.min_sdk),
    versionCode,
    minSupportedVersionCode,
    changelog,
    signerSha256,
  });
}

export function compareMobileVersions(left: string, right: string): number {
  if (!VERSION_PATTERN.test(left) || !VERSION_PATTERN.test(right)) {
    throw new MobileUpdateError('version_compare');
  }
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function isMobileUpdateAvailable(
  currentVersion: string,
  feed: MobileUpdateFeed,
  currentBuild = '',
): boolean {
  const installedVersionCode = Number(currentBuild);
  if (feed.versionCode && Number.isSafeInteger(installedVersionCode) && installedVersionCode > 0) {
    return feed.versionCode > installedVersionCode;
  }
  return compareMobileVersions(feed.version, currentVersion) > 0;
}

export function isMobileUpdateRequired(currentBuild: string, feed: MobileUpdateFeed): boolean {
  const installedVersionCode = Number(currentBuild);
  return Boolean(
    feed.schemaVersion === 2
    && feed.minSupportedVersionCode
    && Number.isSafeInteger(installedVersionCode)
    && installedVersionCode > 0
    && installedVersionCode < feed.minSupportedVersionCode,
  );
}

export function formatMobileUpdateSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '';
  return `${Math.round(sizeBytes / (1024 * 1024))} МБ`;
}

export async function fetchMobileUpdateFeed({
  fetchImpl = globalThis.fetch,
  origin = HUB_WEB_ORIGIN,
  timeoutMs = MOBILE_UPDATE_TIMEOUT_MS,
}: {
  fetchImpl?: typeof globalThis.fetch;
  origin?: string;
  timeoutMs?: number;
} = {}): Promise<MobileUpdateFeed> {
  if (typeof fetchImpl !== 'function') throw new MobileUpdateError('fetch_unavailable');
  const safeOrigin = normalizeUpdateOrigin(origin);
  if (!safeOrigin) throw new MobileUpdateError('origin');
  const manifestUrl = new URL(MOBILE_UPDATE_MANIFEST_PATH, `${safeOrigin}/`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(manifestUrl.href, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok || response.redirected) throw new MobileUpdateError('manifest_http');
    if (response.url && response.url !== manifestUrl.href) throw new MobileUpdateError('manifest_redirect');
    const contentType = String(response.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') throw new MobileUpdateError('manifest_content_type');
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MOBILE_UPDATE_MANIFEST_MAX_BYTES) {
      throw new MobileUpdateError('manifest_size');
    }
    const text = await response.text();
    if (utf8ByteLength(text) > MOBILE_UPDATE_MANIFEST_MAX_BYTES) {
      throw new MobileUpdateError('manifest_size');
    }
    try {
      return parseMobileUpdateManifest(JSON.parse(text), { origin: safeOrigin });
    } catch (error) {
      if (error instanceof MobileUpdateError) throw error;
      throw new MobileUpdateError('manifest_json');
    }
  } catch (error) {
    if (error instanceof MobileUpdateError) throw error;
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new MobileUpdateError('manifest_timeout');
    }
    throw new MobileUpdateError('manifest_network');
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getMobileUpdateErrorMessage(error: unknown): string {
  const code = error instanceof MobileUpdateError ? error.code : '';
  if (code === 'manifest_timeout' || code === 'manifest_network' || code === 'manifest_http') {
    return 'Не удалось проверить обновления. Проверьте подключение к сети.';
  }
  if (code === 'download_size' || code === 'download_hash') {
    return 'Проверка APK не пройдена. Файл удалён; повторите загрузку позже.';
  }
  if (code === 'android_only') return 'Обновление APK доступно только на Android.';
  return 'Не удалось подготовить обновление. Повторите попытку позже.';
}
