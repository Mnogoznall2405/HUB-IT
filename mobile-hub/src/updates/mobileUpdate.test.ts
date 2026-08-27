import {
  compareMobileVersions,
  fetchMobileUpdateFeed,
  formatMobileUpdateSize,
  isMobileUpdateAvailable,
  isMobileUpdateRequired,
  MobileUpdateError,
  parseMobileUpdateManifest,
} from './mobileUpdate';

const manifest = {
  schema_version: 1,
  channel: 'preview',
  version: '1.2.0',
  published_at: '2026-08-22T18:00:00Z',
  relative_path: 'mobile/preview/1.2.0/HUB-IT-Mobile-Preview-1.2.0.apk',
  size_bytes: 102_954_017,
  sha256: 'a'.repeat(64),
  package_name: 'ru.zsgp.hubit.mobile',
  min_sdk: 24,
};

const manifestV2 = {
  ...manifest,
  schema_version: 2,
  version_code: 8,
  min_supported_version_code: 7,
  changelog: ['Нативные вложения', 'Стабильная работа без сети'],
  signer_sha256: 'b'.repeat(64),
};

describe('mobile update feed', () => {
  it('parses only the fixed HUB-IT preview feed and derives a trusted APK URL', () => {
    const feed = parseMobileUpdateManifest(manifest, { origin: 'https://hubit.zsgp.ru' });
    expect(feed.version).toBe('1.2.0');
    expect(feed.downloadUrl).toBe(
      'https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.2.0/HUB-IT-Mobile-Preview-1.2.0.apk',
    );
    expect(feed.sha256).toBe('a'.repeat(64));
  });

  it('rejects path/version mismatches, extra fields and foreign origins', () => {
    expect(() => parseMobileUpdateManifest({
      ...manifest,
      relative_path: 'mobile/preview/1.2.1/HUB-IT-Mobile-Preview-1.2.1.apk',
    })).toThrow(MobileUpdateError);
    expect(() => parseMobileUpdateManifest({ ...manifest, notes: 'unexpected' })).toThrow(MobileUpdateError);
    expect(() => parseMobileUpdateManifest(manifest, { origin: 'https://evil.example' })).toThrow(MobileUpdateError);
  });

  it('compares semantic versions without lexicographic mistakes', () => {
    expect(compareMobileVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareMobileVersions('1.1.4', '1.1.4')).toBe(0);
    expect(compareMobileVersions('1.1.3', '1.1.4')).toBe(-1);
    const feed = parseMobileUpdateManifest(manifest);
    expect(isMobileUpdateAvailable('1.1.4', feed)).toBe(true);
    expect(formatMobileUpdateSize(feed.sizeBytes)).toBe('98 МБ');
  });

  it('uses Android versionCode for schema v2 and detects server-incompatible builds', () => {
    const feed = parseMobileUpdateManifest(manifestV2);
    expect(feed).toMatchObject({
      schemaVersion: 2,
      versionCode: 8,
      minSupportedVersionCode: 7,
      changelog: ['Нативные вложения', 'Стабильная работа без сети'],
      signerSha256: 'b'.repeat(64),
    });
    expect(isMobileUpdateAvailable('1.2.0', feed, '6')).toBe(true);
    expect(isMobileUpdateAvailable('1.1.0', feed, '9')).toBe(false);
    expect(isMobileUpdateRequired('6', feed)).toBe(true);
    expect(isMobileUpdateRequired('7', feed)).toBe(false);
  });

  it('rejects unsafe schema v2 compatibility and changelog values', () => {
    expect(() => parseMobileUpdateManifest({
      ...manifestV2,
      min_supported_version_code: 9,
    })).toThrow(MobileUpdateError);
    expect(() => parseMobileUpdateManifest({
      ...manifestV2,
      changelog: ['bad\nline'],
    })).toThrow(MobileUpdateError);
  });

  it('fetches a bounded JSON manifest without credentials', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      redirected: false,
      url: 'https://hubit.zsgp.ru/desktop-updates/mobile/preview/latest.json',
      headers: new Headers({ 'content-type': 'application/json', 'content-length': '420' }),
      text: async () => JSON.stringify(manifest),
    })) as unknown as typeof fetch;

    const feed = await fetchMobileUpdateFeed({ fetchImpl });
    expect(feed.version).toBe('1.2.0');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hubit.zsgp.ru/desktop-updates/mobile/preview/latest.json',
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    );
  });
});
