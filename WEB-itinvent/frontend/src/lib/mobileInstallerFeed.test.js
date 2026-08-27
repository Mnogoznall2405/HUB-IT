import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_APK_MAX_BYTES,
  MOBILE_MANIFEST_MAX_BYTES,
  fetchMobileInstallerFeed,
  parseMobileInstallerManifest,
  resetMobileInstallerFeedCacheForTests,
} from './mobileInstallerFeed';

const ORIGIN = 'https://hubit.zsgp.ru';
const validManifest = (overrides = {}) => ({
  schema_version: 1,
  channel: 'preview',
  version: '1.1.0',
  published_at: '2026-08-22T08:30:00Z',
  relative_path: 'mobile/preview/1.1.0/HUB-IT-Mobile-Preview-1.1.0.apk',
  size_bytes: 101_086_778,
  sha256: 'a'.repeat(64),
  package_name: 'ru.zsgp.hubit.mobile',
  min_sdk: 24,
  ...overrides,
});

const responseFor = (body, overrides = {}) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'application/json' },
  ...overrides,
});

afterEach(() => {
  resetMobileInstallerFeedCacheForTests();
  vi.restoreAllMocks();
});

describe('mobile installer manifest', () => {
  it('accepts the stable feed and builds a same-origin APK URL', () => {
    const result = parseMobileInstallerManifest(validManifest(), { origin: ORIGIN });

    expect(result.version).toBe('1.1.0');
    expect(result.downloadUrl).toBe(
      `${ORIGIN}/desktop-updates/mobile/preview/1.1.0/HUB-IT-Mobile-Preview-1.1.0.apk`,
    );
    expect(result.packageName).toBe('ru.zsgp.hubit.mobile');
  });

  it('accepts the published schema v2 feed', () => {
    const result = parseMobileInstallerManifest(validManifest({
      schema_version: 2,
      version: '1.1.6',
      relative_path: 'mobile/preview/1.1.6/HUB-IT-Mobile-Preview-1.1.6.apk',
      version_code: 8,
      min_supported_version_code: 1,
      changelog: ['Улучшен нативный Chat'],
      signer_sha256: 'b'.repeat(64),
    }), { origin: ORIGIN });

    expect(result).toMatchObject({
      schemaVersion: 2,
      version: '1.1.6',
      versionCode: 8,
      minSupportedVersionCode: 1,
      changelog: ['Улучшен нативный Chat'],
      signerSha256: 'b'.repeat(64),
    });
  });

  it.each([
    ['invalid version code', { version_code: 0 }, 'version_code'],
    ['unsupported minimum build', { min_supported_version_code: 9 }, 'min_supported_version_code'],
    ['empty changelog', { changelog: [] }, 'changelog'],
    ['invalid signer', { signer_sha256: 'not-a-hash' }, 'signer_sha256'],
  ])('rejects schema v2 with %s', (_label, override, expectedCode) => {
    const schemaV2 = validManifest({
      schema_version: 2,
      version: '1.1.6',
      relative_path: 'mobile/preview/1.1.6/HUB-IT-Mobile-Preview-1.1.6.apk',
      version_code: 8,
      min_supported_version_code: 1,
      changelog: ['Улучшен нативный Chat'],
      signer_sha256: 'b'.repeat(64),
      ...override,
    });

    expect(() => parseMobileInstallerManifest(schemaV2, { origin: ORIGIN }))
      .toThrowError(expect.objectContaining({ code: expectedCode }));
  });

  it.each([
    ['extra field', { unexpected: true }, 'manifest_schema'],
    ['wrong channel', { channel: 'beta' }, 'channel'],
    ['external URL', { relative_path: 'https://evil.example/app.apk' }, 'relative_path'],
    ['path traversal', { relative_path: 'mobile/stable/../app.apk' }, 'relative_path'],
    ['mismatched version', { relative_path: 'mobile/preview/1.2.0/HUB-IT-Mobile-Preview-1.2.0.apk' }, 'relative_path'],
    ['oversized APK', { size_bytes: MOBILE_APK_MAX_BYTES + 1 }, 'size_bytes'],
    ['wrong package', { package_name: 'example.evil.app' }, 'package_name'],
    ['unsupported min SDK', { min_sdk: 23 }, 'min_sdk'],
  ])('rejects %s', (_label, override, expectedCode) => {
    expect(() => parseMobileInstallerManifest(validManifest(override), { origin: ORIGIN }))
      .toThrowError(expect.objectContaining({ code: expectedCode }));
  });

  it('accepts only the canonical HTTPS origin', () => {
    expect(() => parseMobileInstallerManifest(validManifest(), { origin: 'http://hubit.zsgp.ru' }))
      .toThrowError(expect.objectContaining({ code: 'origin' }));
    expect(() => parseMobileInstallerManifest(validManifest(), { origin: 'https://example.com' }))
      .toThrowError(expect.objectContaining({ code: 'origin' }));
  });

  it('rejects corrupt, oversized and non-JSON manifests', async () => {
    await expect(fetchMobileInstallerFeed({
      origin: ORIGIN,
      fetchImpl: vi.fn().mockResolvedValue(responseFor('{broken')),
    })).rejects.toMatchObject({ code: 'manifest_json' });
    await expect(fetchMobileInstallerFeed({
      origin: ORIGIN,
      fetchImpl: vi.fn().mockResolvedValue(responseFor(' '.repeat(MOBILE_MANIFEST_MAX_BYTES + 1))),
    })).rejects.toMatchObject({ code: 'manifest_size' });
    await expect(fetchMobileInstallerFeed({
      origin: ORIGIN,
      fetchImpl: vi.fn().mockResolvedValue(responseFor(JSON.stringify(validManifest()), {
        headers: { 'content-type': 'text/html' },
      })),
    })).rejects.toMatchObject({ code: 'manifest_content_type' });
  });

  it('uses a public direct GET without credentials or redirects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(responseFor(JSON.stringify(validManifest())));

    await fetchMobileInstallerFeed({ origin: ORIGIN, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      `${ORIGIN}/desktop-updates/mobile/preview/latest.json`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      }),
    );
  });
});
