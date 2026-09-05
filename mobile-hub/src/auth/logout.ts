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

/**
 * Ends every authenticated mobile channel in a deterministic order.
 * Server cleanup is best-effort, but local credentials are always removed.
 */
export async function endMobileSession(): Promise<void> {
  chatSocket.disconnect({ reconnect: false, clearSubscriptions: true });

  try {
    await unregisterMobileBackgroundSync();
  } catch {
    // Local credential cleanup must continue if Android rejects task removal.
  }

  let refreshToken: string | null = null;
  try {
    refreshToken = await tokenStore.getRefreshToken();
  } catch {
    // SecureStore can be unavailable during device shutdown; logout still continues.
  }

  try {
    await revokeNativePushToken();
  } catch {
    // Push cleanup is best-effort; the stored token can be reconciled after login.
  }

  try {
    await authApi.revokeMobileBiometricSession();
  } catch {
    // The authenticated logout endpoint also revokes this device when reachable.
  }

  try {
    await authApi.logout(refreshToken);
  } catch {
    // Local logout must not depend on network availability.
  } finally {
    try {
      clearAttachmentCache();
      clearNativeMailCache();
      clearNativeTaskFileCache();
      clearNativeMyFilesCache();
      clearNativeDocflowCache();
      clearNativeFeedFileCache();
      clearNativeDatabaseFileCache();
    } catch {
      // Cache cleanup must not prevent credential revocation.
    }
    await Promise.allSettled([
      tokenStore.clearTokens({ clearOfflineData: true }),
      disableBiometricLogin(),
      clearOfflineCommandQueue(),
      clearPendingChatReplies(),
      clearAllNativeChatDrafts(),
    ]);
  }
}
