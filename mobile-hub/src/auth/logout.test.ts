import * as authApi from '../api/authApi';
import { clearAllNativeChatDrafts } from '../chat/chatDrafts';
import { chatSocket } from '../chat/chatSocket';
import { clearNativeDatabaseFileCache } from '../database/nativeDatabaseFiles';
import { clearNativeFeedFileCache } from '../feed/nativeFeedFiles';
import { clearAttachmentCache } from '../files/nativeAttachmentDownloads';
import { clearOfflineCommandQueue } from '../offline/offlineCommandQueue';
import { revokeNativePushToken } from '../notifications/nativePush';
import { clearPendingChatReplies } from '../notifications/pendingNotificationReplies';
import { unregisterMobileBackgroundSync } from '../lifecycle/mobileBackgroundSync';
import { clearNativeMailCache } from '../mail/nativeMailFiles';
import { clearNativeMyFilesCache } from '../myFiles/nativeMyFilesTransfers';
import { clearNativeDocflowCache } from '../docflow/nativeDocflowFiles';
import { clearNativeTaskFileCache } from '../tasks/nativeTaskFiles';
import * as tokenStore from './tokenStore';
import { disableBiometricLogin } from './biometricAuth';
import { endMobileSession } from './logout';

jest.mock('../api/authApi', () => ({
  logout: jest.fn(async () => undefined),
  revokeMobileBiometricSession: jest.fn(async () => undefined),
}));

jest.mock('../chat/chatSocket', () => ({
  chatSocket: {
    disconnect: jest.fn(),
  },
}));

jest.mock('../chat/chatDrafts', () => ({
  clearAllNativeChatDrafts: jest.fn(async () => undefined),
}));

jest.mock('../notifications/nativePush', () => ({
  revokeNativePushToken: jest.fn(async () => true),
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
  getRefreshToken: jest.fn(async () => 'refresh-token'),
  clearTokens: jest.fn(async () => undefined),
}));

jest.mock('./biometricAuth', () => ({
  disableBiometricLogin: jest.fn(async () => undefined),
}));

describe('endMobileSession', () => {
  it('disconnects Chat, revokes push, logs out and clears local credentials', async () => {
    await endMobileSession();

    expect(chatSocket.disconnect).toHaveBeenCalledWith({
      reconnect: false,
      clearSubscriptions: true,
    });
    expect(revokeNativePushToken).toHaveBeenCalledTimes(1);
    expect(authApi.revokeMobileBiometricSession).toHaveBeenCalledTimes(1);
    expect(authApi.logout).toHaveBeenCalledWith('refresh-token');
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: true });
    expect(disableBiometricLogin).toHaveBeenCalledTimes(1);
    expect(clearAttachmentCache).toHaveBeenCalledTimes(1);
    expect(clearNativeMailCache).toHaveBeenCalledTimes(1);
    expect(clearNativeTaskFileCache).toHaveBeenCalledTimes(1);
    expect(clearNativeMyFilesCache).toHaveBeenCalledTimes(1);
    expect(clearNativeDocflowCache).toHaveBeenCalledTimes(1);
    expect(clearNativeFeedFileCache).toHaveBeenCalledTimes(1);
    expect(clearNativeDatabaseFileCache).toHaveBeenCalledTimes(1);
    expect(clearOfflineCommandQueue).toHaveBeenCalledTimes(1);
    expect(clearPendingChatReplies).toHaveBeenCalledTimes(1);
    expect(clearAllNativeChatDrafts).toHaveBeenCalledTimes(1);
    expect(unregisterMobileBackgroundSync).toHaveBeenCalledTimes(1);

    const disconnectOrder = (chatSocket.disconnect as jest.Mock).mock.invocationCallOrder[0];
    const revokeOrder = (revokeNativePushToken as jest.Mock).mock.invocationCallOrder[0];
    const logoutOrder = (authApi.logout as jest.Mock).mock.invocationCallOrder[0];
    const clearOrder = (tokenStore.clearTokens as jest.Mock).mock.invocationCallOrder[0];
    expect(disconnectOrder).toBeLessThan(revokeOrder);
    expect(revokeOrder).toBeLessThan(logoutOrder);
    expect(logoutOrder).toBeLessThan(clearOrder);
  });

  it('clears local credentials when remote cleanup fails', async () => {
    (revokeNativePushToken as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    (authApi.logout as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    await expect(endMobileSession()).resolves.toBeUndefined();
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: true });
    expect(disableBiometricLogin).toHaveBeenCalledTimes(1);
  });
});
