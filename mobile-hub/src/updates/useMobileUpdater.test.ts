import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockFetchMobileUpdateFeed = jest.fn();
const mockDownloadAndInstall = jest.fn();
const mockOpenUnknownSourcesSettings = jest.fn();

jest.mock('expo-application', () => ({
  applicationId: 'ru.zsgp.hubit.mobile',
  nativeApplicationVersion: '1.1.3',
  nativeBuildVersion: '5',
}));

jest.mock('./mobileUpdate', () => {
  const actual = jest.requireActual('./mobileUpdate');
  return {
    ...actual,
    fetchMobileUpdateFeed: (...args: unknown[]) => mockFetchMobileUpdateFeed(...args),
  };
});

jest.mock('./mobileUpdateInstaller', () => ({
  downloadAndInstallMobileUpdate: (...args: unknown[]) => mockDownloadAndInstall(...args),
  openUnknownSourcesSettings: (...args: unknown[]) => mockOpenUnknownSourcesSettings(...args),
}));

import { parseMobileUpdateManifest } from './mobileUpdate';
import { useMobileUpdater } from './useMobileUpdater';

const feed = parseMobileUpdateManifest({
  schema_version: 1,
  channel: 'preview',
  version: '1.1.4',
  published_at: '2026-08-22T18:00:00Z',
  relative_path: 'mobile/preview/1.1.4/HUB-IT-Mobile-Preview-1.1.4.apk',
  size_bytes: 102_954_017,
  sha256: 'a'.repeat(64),
  package_name: 'ru.zsgp.hubit.mobile',
  min_sdk: 24,
});

const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');

describe('useMobileUpdater', () => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    mockFetchMobileUpdateFeed.mockReset();
    mockDownloadAndInstall.mockReset();
    mockOpenUnknownSourcesSettings.mockReset();
    mockFetchMobileUpdateFeed.mockResolvedValue(feed);
    mockDownloadAndInstall.mockImplementation(async (_feed, onProgress) => {
      onProgress({ phase: 'downloading', progress: 0.5 });
      onProgress({ phase: 'verifying', progress: 1 });
      onProgress({ phase: 'installing', progress: 1 });
    });
  });

  afterAll(() => {
    if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
  });

  it('moves from feed check to download, integrity verification and Android installer', async () => {
    const { result } = await renderHook(() => useMobileUpdater());

    await act(async () => {
      await result.current.checkForUpdate();
    });
    expect(result.current.state.status).toBe('available');
    expect(result.current.state.feed?.version).toBe('1.1.4');

    await act(async () => {
      await result.current.installUpdate();
    });
    expect(mockDownloadAndInstall).toHaveBeenCalledWith(feed, expect.any(Function));
    expect(result.current.state.status).toBe('installing');
    expect(result.current.state.message).toContain('системном установщике Android');
  });
});
