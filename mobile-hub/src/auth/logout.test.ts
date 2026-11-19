import axios from 'axios';
import * as Notifications from 'expo-notifications';
import { Image } from 'expo-image';
import { clearAllNativeChatDrafts } from '../chat/chatDrafts';
import { chatSocket } from '../chat/chatSocket';
import { clearNativeDatabaseFileCache } from '../database/nativeDatabaseFiles';
import { clearNativeFeedFileCache } from '../feed/nativeFeedFiles';
import { clearAttachmentCache } from '../files/nativeAttachmentDownloads';
import { clearOfflineCommandQueue } from '../offline/offlineCommandQueue';
import { clearPendingChatReplies } from '../notifications/pendingNotificationReplies';
import { unregisterMobileBackgroundSync } from '../lifecycle/mobileBackgroundSync';
import { clearNativeMailCache } from '../mail/nativeMailFiles';
import { clearNativeMyFilesCache } from '../myFiles/nativeMyFilesTransfers';
import { clearNativeDocflowCache } from '../docflow/nativeDocflowFiles';
import { clearNativeTaskFileCache } from '../tasks/nativeTaskFiles';
import * as tokenStore from './tokenStore';
import { disableBiometricLogin } from './biometricAuth';
import { endMobileSession } from './logout';
import { forgetPendingLogoutCleanup, rememberPendingLogoutCleanup } from './pendingLogoutCleanup';
import { clearIncomingShare } from '../share/incomingShare';
import { clearMailQuickReplyDrafts } from '../mail/mailQuickReplyDrafts';
jest.mock('../mail/mailQuickReplyDrafts', () => ({ clearMailQuickReplyDrafts: jest.fn(async () => undefined) }));

jest.mock('../share/incomingShare', () => ({
  clearIncomingShare: jest.fn(async () => undefined),
  discardIncomingShare: jest.fn(),
  getPendingIncomingTextShare: jest.fn(async () => null),
}));

jest.mock('axios', () => ({
  delete: jest.fn(async () => ({ data: {} })),
  post: jest.fn(async () => ({ data: {} })),
}));

jest.mock('expo-notifications', () => ({
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
}));

jest.mock('../api/client', () => ({
  withMobileAuthHeaders: (clientDeviceId?: string | null) => ({
    'X-HubIT-Mobile': 'android',
    ...(clientDeviceId ? { 'X-Client-Device-Id': clientDeviceId } : {}),
  }),
}));

jest.mock('../chat/chatSocket', () => ({
  chatSocket: {
    disconnect: jest.fn(),
  },
}));

jest.mock('../chat/chatDrafts', () => ({
  clearAllNativeChatDrafts: jest.fn(async () => undefined),
}));

jest.mock('../files/nativeAttachmentDownloads', () => ({
  clearAttachmentCache: jest.fn(),
}));

jest.mock('../feed/nativeFeedFiles', () => ({
  clearNativeFeedFileCache: jest.fn(),
}));

jest.mock('../database/nativeDatabaseFiles', () => ({
  clearNativeDatabaseFileCache: jest.fn(),
}));

jest.mock('../mail/nativeMailFiles', () => ({
  clearNativeMailCache: jest.fn(),
}));

jest.mock('../tasks/nativeTaskFiles', () => ({
  clearNativeTaskFileCache: jest.fn(),
}));

jest.mock('../myFiles/nativeMyFilesTransfers', () => ({
  clearNativeMyFilesCache: jest.fn(),
}));

jest.mock('../docflow/nativeDocflowFiles', () => ({
  clearNativeDocflowCache: jest.fn(),
}));

jest.mock('../offline/offlineCommandQueue', () => ({
  clearOfflineCommandQueue: jest.fn(async () => undefined),
}));

jest.mock('../notifications/pendingNotificationReplies', () => ({
  clearPendingChatReplies: jest.fn(async () => undefined),
}));

jest.mock('../lifecycle/mobileBackgroundSync', () => ({
  unregisterMobileBackgroundSync: jest.fn(async () => undefined),
}));

jest.mock('./tokenStore', () => ({
  getAccessToken: jest.fn(async () => 'access-A'),
  getRefreshToken: jest.fn(async () => 'refresh-A'),
  getClientDeviceId: jest.fn(async () => 'device-A'),
  getNativePushToken: jest.fn(async () => 'push-A'),
  clearNativePushToken: jest.fn(async () => undefined),
  clearTokens: jest.fn(async () => undefined),
}));

jest.mock('./biometricAuth', () => ({
  disableBiometricLogin: jest.fn(async () => undefined),
}));

jest.mock('./pendingLogoutCleanup', () => ({
  rememberPendingLogoutCleanup: jest.fn(async () => undefined),
  forgetPendingLogoutCleanup: jest.fn(async () => undefined),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  // One macrotask boundary drains the whole microtask queue, including
  // continuations queued while the queue was already being processed.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('endMobileSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.delete.mockResolvedValue({ data: {} });
    mockedAxios.post.mockResolvedValue({ data: {} });
    jest.mocked(tokenStore.getAccessToken).mockResolvedValue('access-A');
    jest.mocked(tokenStore.getRefreshToken).mockResolvedValue('refresh-A');
    jest.mocked(tokenStore.getClientDeviceId).mockResolvedValue('device-A');
    jest.mocked(tokenStore.getNativePushToken).mockResolvedValue('push-A');
  });

  it('disconnects Chat, revokes push, logs out and clears local credentials', async () => {
    await endMobileSession();

    expect(chatSocket.disconnect).toHaveBeenCalledWith({
      reconnect: false,
      clearSubscriptions: true,
    });
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/settings/notifications/native-push-token'),
      expect.objectContaining({ data: { token: 'push-A' } }),
    );
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/auth/mobile-biometric'),
      expect.anything(),
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      { refresh_token: 'refresh-A' },
      expect.anything(),
    );
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled();
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: true });
    expect(disableBiometricLogin).toHaveBeenCalledTimes(1);
    expect(clearAttachmentCache).toHaveBeenCalledTimes(1);
    expect(Image.clearMemoryCache).toHaveBeenCalledTimes(1);
    expect(Image.clearDiskCache).toHaveBeenCalledTimes(1);
    expect(clearNativeMailCache).toHaveBeenCalledTimes(1);
    expect(clearNativeTaskFileCache).toHaveBeenCalledTimes(1);
    expect(clearNativeMyFilesCache).toHaveBeenCalledTimes(1);
    expect(clearNativeDocflowCache).toHaveBeenCalledTimes(1);
    expect(clearNativeFeedFileCache).toHaveBeenCalledTimes(1);
    expect(clearNativeDatabaseFileCache).toHaveBeenCalledTimes(1);
    expect(clearOfflineCommandQueue).toHaveBeenCalledTimes(1);
    expect(clearPendingChatReplies).toHaveBeenCalledTimes(1);
    expect(clearAllNativeChatDrafts).toHaveBeenCalledTimes(1);
    expect(clearMailQuickReplyDrafts).toHaveBeenCalledTimes(1);
    expect(unregisterMobileBackgroundSync).toHaveBeenCalledTimes(1);
    expect(rememberPendingLogoutCleanup).toHaveBeenCalledWith({
      refreshToken: 'refresh-A',
      clientDeviceId: 'device-A',
      pushToken: 'push-A',
    });
    await flushMicrotasks();
    expect(forgetPendingLogoutCleanup).toHaveBeenCalledTimes(1);
    expect(forgetPendingLogoutCleanup).toHaveBeenCalledWith('refresh-A');
    // The FCM token is device-wide: never cleared locally on logout.
    expect(tokenStore.clearNativePushToken).not.toHaveBeenCalled();
  });

  it('awaits the native share cleanup before the session ends', async () => {
    const gate = deferred();
    jest.mocked(clearIncomingShare).mockReturnValueOnce(gate.promise);
    let settled = false;
    const session = endMobileSession().then(() => { settled = true; });
    await flushMicrotasks();

    // The next sign-in must not start until the native share slot is cleared —
    // a fire-and-forget cleanup would let user B inherit A's pending share.
    expect(settled).toBe(false);
    expect(clearIncomingShare).toHaveBeenCalledTimes(1);

    gate.resolve();
    await session;
    expect(settled).toBe(true);
  });

  it('persists the deferred logout record before wiping local credentials', async () => {
    const gate = deferred();
    jest.mocked(rememberPendingLogoutCleanup).mockReturnValueOnce(gate.promise);

    const session = endMobileSession();
    await flushMicrotasks();

    // Durability first: the queued copy must land before clearTokens erases
    // the only other copy of the refresh token.
    expect(rememberPendingLogoutCleanup).toHaveBeenCalledWith({
      refreshToken: 'refresh-A',
      clientDeviceId: 'device-A',
      pushToken: 'push-A',
    });
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();

    gate.resolve();
    await session;
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: true });
  });

  it('keeps the queued record when the logout request fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('offline'));

    await endMobileSession();
    await flushMicrotasks();

    expect(rememberPendingLogoutCleanup).toHaveBeenCalledWith({
      refreshToken: 'refresh-A',
      clientDeviceId: 'device-A',
      pushToken: 'push-A',
    });
    expect(forgetPendingLogoutCleanup).not.toHaveBeenCalled();
  });

  it('authenticates server cleanup with the captured credentials, not the current session (MB-02)', async () => {
    const gate = deferred();
    mockedAxios.delete.mockImplementationOnce(() => gate.promise as never);

    await endMobileSession();
    // The push revoke is stuck in flight: by the time it resolves user B owns
    // the token store. Every subsequent call must still carry A's token.
    jest.mocked(tokenStore.getAccessToken).mockResolvedValue('access-B');
    jest.mocked(tokenStore.getRefreshToken).mockResolvedValue('refresh-B');
    gate.resolve({ data: {} } as never);
    await flushMicrotasks();

    const auths = [
      ...mockedAxios.delete.mock.calls.map((call) => call[1]?.headers?.Authorization),
      ...mockedAxios.post.mock.calls.map((call) => call[2]?.headers?.Authorization),
    ];
    expect(auths.length).toBeGreaterThanOrEqual(2);
    for (const header of auths) expect(header).toBe('Bearer access-A');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      { refresh_token: 'refresh-A' },
      expect.anything(),
    );
    // The FCM token is device-wide: A's cleanup must never erase B's
    // identical registration locally — server revoke covers it.
    expect(tokenStore.clearNativePushToken).not.toHaveBeenCalled();
    expect(forgetPendingLogoutCleanup).toHaveBeenCalledTimes(1);
    expect(forgetPendingLogoutCleanup).toHaveBeenCalledWith('refresh-A');
  });

  it('keeps a newer stored push token when it already belongs to the next account', async () => {
    jest.mocked(tokenStore.getNativePushToken)
      .mockResolvedValueOnce('push-A')   // captured at logout start
      .mockResolvedValue('push-B');      // stored again by B's registration
    await endMobileSession();

    await flushMicrotasks();
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/settings/notifications/native-push-token'),
      expect.objectContaining({ data: { token: 'push-A' } }),
    );
    expect(tokenStore.clearNativePushToken).not.toHaveBeenCalled();
  });

  it('clears local credentials when remote cleanup fails', async () => {
    mockedAxios.delete.mockRejectedValue(new Error('offline'));
    mockedAxios.post.mockRejectedValue(new Error('offline'));

    await expect(endMobileSession()).resolves.toBeUndefined();
    await flushMicrotasks();
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: true });
    expect(disableBiometricLogin).toHaveBeenCalledTimes(1);
    expect(forgetPendingLogoutCleanup).not.toHaveBeenCalled();
  });

  it('runs the same local wipe without any server request for a deactivated account', async () => {
    await endMobileSession({ contactServer: false });

    expect(mockedAxios.delete).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(rememberPendingLogoutCleanup).not.toHaveBeenCalled();
    expect(forgetPendingLogoutCleanup).not.toHaveBeenCalled();
    // The local wipe is identical to logout.
    expect(chatSocket.disconnect).toHaveBeenCalledWith({
      reconnect: false,
      clearSubscriptions: true,
    });
    expect(unregisterMobileBackgroundSync).toHaveBeenCalledTimes(1);
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: true });
    expect(disableBiometricLogin).toHaveBeenCalledTimes(1);
    expect(clearOfflineCommandQueue).toHaveBeenCalledTimes(1);
    expect(clearPendingChatReplies).toHaveBeenCalledTimes(1);
    expect(clearAllNativeChatDrafts).toHaveBeenCalledTimes(1);
  });
});
