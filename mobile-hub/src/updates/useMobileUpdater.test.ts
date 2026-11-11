import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockFetchMobileUpdateFeed = jest.fn();
const mockDownloadAndInstall = jest.fn();
const mockOpenUnknownSourcesSettings = jest.fn();
const mockInspectDownload = jest.fn();
const mockInstallPrepared = jest.fn();
const mockPauseDownload = jest.fn();
const mockClearDownload = jest.fn();

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
  inspectMobileUpdateDownload: (...args: unknown[]) => mockInspectDownload(...args),
  installPreparedMobileUpdate: (...args: unknown[]) => mockInstallPrepared(...args),
  pauseMobileUpdateDownload: (...args: unknown[]) => mockPauseDownload(...args),
  clearMobileUpdateDownload: (...args: unknown[]) => mockClearDownload(...args),
}));

import { MobileUpdateError, parseMobileUpdateManifest } from './mobileUpdate';
import {
  MOBILE_UPDATE_AUTO_CHECK_INTERVAL_MS,
  shouldAutoCheckMobileUpdate,
  useMobileUpdaterController,
} from './useMobileUpdater';

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
    mockInspectDownload.mockReset();
    mockInstallPrepared.mockReset();
    mockPauseDownload.mockReset();
    mockClearDownload.mockReset();
    mockFetchMobileUpdateFeed.mockResolvedValue(feed);
    mockInspectDownload.mockResolvedValue({ kind: 'empty', bytesWritten: 0, totalBytes: feed.sizeBytes });
    mockDownloadAndInstall.mockImplementation(async (_feed, onProgress) => {
      onProgress({ phase: 'downloading', progress: 0.5, bytesWritten: 50, totalBytes: 100 });
      onProgress({ phase: 'verifying', progress: 1, bytesWritten: 100, totalBytes: 100 });
      onProgress({ phase: 'installing', progress: 1, bytesWritten: 100, totalBytes: 100 });
    });
  });

  afterAll(() => {
    if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
  });

  it('moves from feed check to download, integrity verification and Android installer', async () => {
    const { result } = await renderHook(() => useMobileUpdaterController());

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

  it('throttles automatic foreground checks for thirty minutes', () => {
    expect(shouldAutoCheckMobileUpdate({
      now: MOBILE_UPDATE_AUTO_CHECK_INTERVAL_MS - 1,
      lastCheckedAt: 0,
      hasUser: true,
      offline: false,
      status: 'current',
    })).toBe(false);
    expect(shouldAutoCheckMobileUpdate({
      now: MOBILE_UPDATE_AUTO_CHECK_INTERVAL_MS,
      lastCheckedAt: 0,
      hasUser: true,
      offline: false,
      status: 'current',
    })).toBe(true);
    expect(shouldAutoCheckMobileUpdate({
      now: MOBILE_UPDATE_AUTO_CHECK_INTERVAL_MS * 2,
      lastCheckedAt: 0,
      hasUser: true,
      offline: true,
      status: 'current',
    })).toBe(false);
  });

  it('keeps a partial APK available for an explicit resume after a network interruption', async () => {
    const { result } = await renderHook(() => useMobileUpdaterController());
    await act(async () => {
      await result.current.checkForUpdate();
    });
    mockDownloadAndInstall.mockRejectedValueOnce(new MobileUpdateError('download_paused'));
    mockInspectDownload.mockResolvedValueOnce({
      kind: 'paused',
      bytesWritten: 40,
      totalBytes: 100,
    });

    await act(async () => {
      await result.current.installUpdate();
    });

    expect(result.current.state.status).toBe('paused');
    expect(result.current.state.bytesWritten).toBe(40);
    expect(result.current.state.message).toContain('Продолжить');
  });

  it('reopens a previously verified APK without downloading it again', async () => {
    mockInspectDownload.mockResolvedValueOnce({
      kind: 'ready',
      bytesWritten: feed.sizeBytes,
      totalBytes: feed.sizeBytes,
    });
    const { result } = await renderHook(() => useMobileUpdaterController());
    await act(async () => {
      await result.current.checkForUpdate();
    });
    expect(result.current.state.status).toBe('ready');

    await act(async () => {
      await result.current.installUpdate();
    });

    expect(mockInstallPrepared).toHaveBeenCalledWith(feed, expect.any(Function));
    expect(mockDownloadAndInstall).not.toHaveBeenCalled();
  });
});
