import {
  createMobileOfflineReadOnlyError,
  clearMobileOfflineCache,
  clearMobileOfflineCacheForUserIds,
  getMobileOfflineCacheInventory,
  getMobileOfflineCacheMeta,
  getMobileOfflineState,
  isMobileOfflineMutationBlocked,
  markMobileOfflineCacheMiss,
  waitForPendingMobileOfflineCacheWrites,
} from './mobileOfflineCache';

const user = {
  id: 7,
  username: 'mobile-test',
  role: 'viewer',
  permissions: ['dashboard.read'],
};

describe('mobile encrypted offline cache gate', () => {
  afterEach(() => {
    delete window.__HUBIT_MOBILE_APP__;
    delete window.__HUBIT_MOBILE_OFFLINE_SESSION__;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('does not change PWA requests without the native marker', () => {
    expect(getMobileOfflineState()).toEqual({ enabled: false, readOnly: false });
    expect(isMobileOfflineMutationBlocked({ method: 'post', url: '/hub/tasks' })).toBe(false);
  });

  it('does not expose or clear IndexedDB cache outside the native session', async () => {
    await expect(getMobileOfflineCacheInventory()).resolves.toEqual({
      ready: false,
      entryCount: 0,
      ciphertextBytes: 0,
      modules: [],
      moduleDetails: [],
      lastSyncAt: 0,
      cacheMiss: false,
    });
    await expect(waitForPendingMobileOfflineCacheWrites()).resolves.toBeUndefined();
    await expect(clearMobileOfflineCache()).resolves.toBe(0);
    await expect(clearMobileOfflineCacheForUserIds([7])).resolves.toBe(0);
  });

  it('removes deferred per-user metadata only inside the APK marker', async () => {
    window.__HUBIT_MOBILE_APP__ = true;
    window.localStorage.setItem('hubit:mobile-offline-last-sync:7', '1787400000000');
    window.localStorage.setItem('hubit:mobile-offline-last-sync:9', '1787400000001');
    window.sessionStorage.setItem('hubit:mobile-offline-cache-miss:7', '1787400000002');

    await clearMobileOfflineCacheForUserIds([7, 7, -1]);

    expect(window.localStorage.getItem('hubit:mobile-offline-last-sync:7')).toBeNull();
    expect(window.sessionStorage.getItem('hubit:mobile-offline-cache-miss:7')).toBeNull();
    expect(window.localStorage.getItem('hubit:mobile-offline-last-sync:9')).toBe('1787400000001');
  });

  it('blocks writes but allows reads in biometric offline mode', () => {
    window.__HUBIT_MOBILE_APP__ = true;
    window.__HUBIT_MOBILE_OFFLINE_SESSION__ = {
      user,
      cacheKey: 'a'.repeat(64),
      readOnly: true,
    };

    expect(getMobileOfflineState()).toEqual({ enabled: true, readOnly: true });
    expect(isMobileOfflineMutationBlocked({ method: 'get', url: '/mail/messages' })).toBe(false);
    expect(isMobileOfflineMutationBlocked({ method: 'post', url: '/mail/send' })).toBe(true);
    expect(createMobileOfflineReadOnlyError({ method: 'post' })).toMatchObject({
      code: 'HUBIT_OFFLINE_READ_ONLY',
      message: 'Без интернета доступен только просмотр ранее загруженных данных.',
    });
    const writeError = createMobileOfflineReadOnlyError({ method: 'post', url: '/mail/send' });
    expect(markMobileOfflineCacheMiss(writeError)).toBe(writeError);
    expect(writeError.code).toBe('HUBIT_OFFLINE_READ_ONLY');
  });

  it('rejects malformed native cache credentials', () => {
    window.__HUBIT_MOBILE_APP__ = true;
    window.__HUBIT_MOBILE_OFFLINE_SESSION__ = {
      user,
      cacheKey: 'not-a-key',
      readOnly: true,
    };
    expect(getMobileOfflineState()).toEqual({ enabled: false, readOnly: false });
  });

  it('exposes per-user last-sync and cache-miss metadata only to the native session', () => {
    window.__HUBIT_MOBILE_APP__ = true;
    window.__HUBIT_MOBILE_OFFLINE_SESSION__ = {
      user,
      cacheKey: 'a'.repeat(64),
      readOnly: true,
    };
    window.localStorage.setItem('hubit:mobile-offline-last-sync:7', '1787400000000');

    expect(getMobileOfflineCacheMeta()).toEqual({
      lastSyncAt: 1787400000000,
      cacheMiss: false,
    });

    const error = { config: { method: 'get', url: '/hub/dashboard' } };
    markMobileOfflineCacheMiss(error);
    expect(getMobileOfflineCacheMeta()).toEqual({
      lastSyncAt: 1787400000000,
      cacheMiss: true,
    });
  });
});
