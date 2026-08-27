import { sha256HexFromChunks, validateDownloadedUpdate } from './mobileUpdateInstaller';
import { MobileUpdateError, parseMobileUpdateManifest } from './mobileUpdate';

jest.mock('expo-file-system', () => ({
  Directory: class Directory {},
  File: class File {},
  FileMode: { ReadOnly: 'r' },
  Paths: { cache: 'file:///cache' },
}));

jest.mock('expo-intent-launcher', () => ({
  ActivityAction: { MANAGE_UNKNOWN_APP_SOURCES: 'android.settings.MANAGE_UNKNOWN_APP_SOURCES' },
  startActivityAsync: jest.fn(),
}));

const feed = parseMobileUpdateManifest({
  schema_version: 1,
  channel: 'preview',
  version: '1.2.0',
  published_at: '2026-08-22T18:00:00Z',
  relative_path: 'mobile/preview/1.2.0/HUB-IT-Mobile-Preview-1.2.0.apk',
  size_bytes: 3,
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
  package_name: 'ru.zsgp.hubit.mobile',
  min_sdk: 24,
});

describe('mobile update installer integrity', () => {
  it('computes the same SHA-256 across bounded chunks', () => {
    expect(sha256HexFromChunks([
      Uint8Array.from([1]),
      Uint8Array.from([2, 3]),
    ])).toBe(feed.sha256);
  });

  it('requires both the exact APK size and SHA-256', () => {
    expect(() => validateDownloadedUpdate(3, feed.sha256, feed)).not.toThrow();
    expect(() => validateDownloadedUpdate(4, feed.sha256, feed)).toThrow(MobileUpdateError);
    expect(() => validateDownloadedUpdate(3, '0'.repeat(64), feed)).toThrow(MobileUpdateError);
  });
});
