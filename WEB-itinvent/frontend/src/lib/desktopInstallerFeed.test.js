import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_MANIFEST_MAX_BYTES,
  DESKTOP_SETUP_MAX_BYTES,
  DesktopInstallerFeedError,
  detectDesktopDownloadPlatform,
  fetchDesktopInstallerFeed,
  parseDesktopInstallerManifest,
  resetDesktopInstallerFeedCacheForTests,
} from './desktopInstallerFeed';

const ORIGIN = 'https://hubit.zsgp.ru';

const validManifest = (overrides = {}) => ({
  schema_version: 1,
  channel: 'stable',
  version: '0.1.12',
  published_at: '2026-08-12T10:00:00Z',
  relative_path: 'stable/0.1.12/HUB-Desktop-Setup-0.1.12-win-x64.exe',
  size_bytes: 413_449_628,
  sha256: 'a'.repeat(64),
  release_notes: ['Улучшена стабильность.'],
  signature: {
    algorithm: 'RSA-PSS-SHA256',
    key_id: 'hub-desktop-update-2026-01',
    value: 'c2lnbmF0dXJl',
  },
  ...overrides,
});

const responseFor = (body, overrides = {}) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'application/json' },
  ...overrides,
});

afterEach(() => {
  resetDesktopInstallerFeedCacheForTests();
  vi.restoreAllMocks();
});

describe('desktop installer manifest', () => {
  it('accepts the signed stable feed and builds a same-origin Setup URL', () => {
    const result = parseDesktopInstallerManifest(validManifest(), { origin: ORIGIN });

    expect(result.version).toBe('0.1.12');
    expect(result.downloadUrl).toBe(
      `${ORIGIN}/desktop-updates/stable/0.1.12/HUB-Desktop-Setup-0.1.12-win-x64.exe`,
    );
    expect(result.sizeBytes).toBe(413_449_628);
  });

  it('accepts only the canonical HTTPS download origin', () => {
    expect(() => parseDesktopInstallerManifest(validManifest(), { origin: 'http://hubit.zsgp.ru' }))
      .toThrowError(expect.objectContaining({ code: 'origin' }));
    expect(() => parseDesktopInstallerManifest(validManifest(), { origin: 'https://example.com' }))
      .toThrowError(expect.objectContaining({ code: 'origin' }));
  });

  it.each([
    ['extra field', { unexpected: true }, 'manifest_schema'],
    ['wrong channel', { channel: 'beta' }, 'channel'],
    ['external URL', { relative_path: 'https://evil.example/setup.exe' }, 'relative_path'],
    ['path traversal', { relative_path: 'stable/../setup.exe' }, 'relative_path'],
    ['mismatched version', { relative_path: 'stable/0.1.13/HUB-Desktop-Setup-0.1.13-win-x64.exe' }, 'relative_path'],
    ['oversized Setup', { size_bytes: DESKTOP_SETUP_MAX_BYTES + 1 }, 'size_bytes'],
    ['invalid semver', { version: '0.1' }, 'version'],
    ['wrong signature algorithm', { signature: { ...validManifest().signature, algorithm: 'RSA-SHA256' } }, 'signature'],
  ])('rejects %s', (_label, override, expectedCode) => {
    expect(() => parseDesktopInstallerManifest(validManifest(override), { origin: ORIGIN }))
      .toThrowError(expect.objectContaining({ code: expectedCode }));
  });

  it('rejects corrupted JSON without breaking the caller', async () => {
    await expect(fetchDesktopInstallerFeed({
      origin: ORIGIN,
      fetchImpl: vi.fn().mockResolvedValue(responseFor('{broken')),
    })).rejects.toMatchObject({ name: 'DesktopInstallerFeedError', code: 'manifest_json' });
  });

  it('rejects disabled and oversized feeds', async () => {
    await expect(fetchDesktopInstallerFeed({
      origin: ORIGIN,
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 404 })),
    })).rejects.toMatchObject({ code: 'manifest_http' });

    const oversized = ' '.repeat(DESKTOP_MANIFEST_MAX_BYTES + 1);
    await expect(fetchDesktopInstallerFeed({
      origin: ORIGIN,
      fetchImpl: vi.fn().mockResolvedValue(responseFor(oversized)),
    })).rejects.toMatchObject({ code: 'manifest_size' });
  });

  it('rejects a manifest served with a non-JSON content type', async () => {
    await expect(fetchDesktopInstallerFeed({
      origin: ORIGIN,
      fetchImpl: vi.fn().mockResolvedValue(responseFor(JSON.stringify(validManifest()), {
        headers: { 'content-type': 'text/html' },
      })),
    })).rejects.toMatchObject({ code: 'manifest_content_type' });
  });

  it('uses a direct GET without credentials, redirects or a Blob download', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(responseFor(JSON.stringify(validManifest())));

    await fetchDesktopInstallerFeed({ origin: ORIGIN, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(`${ORIGIN}/desktop-updates/stable/latest.json`, expect.objectContaining({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    }));
  });
});

describe('desktop download platform', () => {
  it('allows Windows browsers and blocks mobile or non-Windows devices', () => {
    expect(detectDesktopDownloadPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 Windows NT 10.0' }).supported)
      .toBe(true);
    expect(detectDesktopDownloadPlatform({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 Android Mobile' }).supported)
      .toBe(false);
    expect(detectDesktopDownloadPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 Macintosh' }).supported)
      .toBe(false);
  });
});

it('exposes typed feed errors for UI fallback handling', () => {
  expect(new DesktopInstallerFeedError('manifest_http')).toMatchObject({
    name: 'DesktopInstallerFeedError',
    code: 'manifest_http',
  });
});
