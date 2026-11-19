import * as Notifications from 'expo-notifications';
import { clearMailQuickReplyDrafts } from '../mail/mailQuickReplyDrafts';
import { clearMailComposeDrafts } from '../mail/nativeMailComposeDrafts';
import { clearNativeFormDrafts } from '../drafts/nativeFormDrafts';
import { clearNativeChatOutbox } from '../chat/nativeChatOutbox';
import { clearMailComposeTransfers } from '../mail/nativeMailComposeTransfer';
import axios from 'axios';
import { API_V1_BASE } from '../api/config';
import { withMobileAuthHeaders } from '../api/client';
import { clearAllNativeChatDrafts } from '../chat/chatDrafts';
import { chatSocket } from '../chat/chatSocket';
import { clearNativeDatabaseFileCache } from '../database/nativeDatabaseFiles';
import { clearNativeFeedFileCache } from '../feed/nativeFeedFiles';
import { clearAttachmentCache } from '../files/nativeAttachmentDownloads';
import { clearNativeImageCache } from '../files/nativeImageCache';
import { clearOfflineCommandQueue } from '../offline/offlineCommandQueue';
import { clearPendingChatReplies } from '../notifications/pendingNotificationReplies';
import { unregisterMobileBackgroundSync } from '../lifecycle/mobileBackgroundSync';
import { clearPendingPortalPath } from '../navigation/systemIntent';
import { clearNativeMailCache } from '../mail/nativeMailFiles';
import { clearNativeMyFilesCache } from '../myFiles/nativeMyFilesTransfers';
import { clearNativeDocflowCache } from '../docflow/nativeDocflowFiles';
import { clearNativeTaskFileCache } from '../tasks/nativeTaskFiles';
import { clearNativeKbCache } from '../help/nativeKbFiles';
import { clearNativeWarehouse1cCache } from '../warehouse1c/nativeWarehouse1cFiles';
import * as tokenStore from './tokenStore';
import { disableBiometricLogin } from './biometricAuth';
import { forgetPendingLogoutCleanup, rememberPendingLogoutCleanup } from './pendingLogoutCleanup';
import { clearIncomingShare } from '../share/incomingShare';

const SERVER_CLEANUP_TIMEOUT_MS = 15_000;

function dismissDeliveredNotifications(): Promise<unknown> {
  try {
    return Notifications.dismissAllNotificationsAsync();
  } catch {
    return Promise.resolve();
  }
}

type CapturedLogoutCredentials = {
  accessToken: string | null;
  refreshToken: string | null;
  clientDeviceId: string | null;
  pushToken: string | null;
};

// The shared apiClient injects whatever access token is current when the
// request finally fires — on a shared device that can already be the NEXT
// account's token (the local wipe is instant, the network is not). Server
// revocation therefore runs through plain axios with the credentials captured
// at logout start, so user B can never lose a session or biometric credential
// to user A's logout (MB-02).
async function revokeCapturedSession(credentials: CapturedLogoutCredentials): Promise<void> {
  const headers = {
    'Content-Type': 'application/json',
    ...withMobileAuthHeaders(credentials.clientDeviceId),
    ...(credentials.accessToken ? { Authorization: `Bearer ${credentials.accessToken}` } : {}),
  };
  if (credentials.pushToken) {
    try {
      await axios.delete(`${API_V1_BASE}/settings/notifications/native-push-token`, {
        data: { token: credentials.pushToken },
        headers,
        timeout: SERVER_CLEANUP_TIMEOUT_MS,
      });
      // The FCM token is device-wide and may already be re-registered by the
      // next account: never clear it locally — server revoke is enough.
    } catch {
      // Best-effort: a deferred logout replay still revokes push server-side.
    }
  }
  try {
    await axios.delete(`${API_V1_BASE}/auth/mobile-biometric`, {
      headers,
      timeout: SERVER_CLEANUP_TIMEOUT_MS,
    });
  } catch {
    // The authenticated logout endpoint also revokes this device when reachable.
  }
  try {
    await axios.post(
      `${API_V1_BASE}/auth/logout`,
      credentials.refreshToken ? { refresh_token: credentials.refreshToken } : {},
      { headers, timeout: SERVER_CLEANUP_TIMEOUT_MS },
    );
    if (credentials.refreshToken) {
      await forgetPendingLogoutCleanup(credentials.refreshToken).catch(() => undefined);
    }
  } catch {
    // Local logout must not depend on network availability; the queued
    // record stays for the next deferred replay.
  }
}

/**
 * Ends every authenticated mobile channel in a deterministic order.
 * Server cleanup is best-effort, but local credentials are always removed.
 * `contactServer: false` performs the same local wipe without any server
 * request — used when HUB-IT reports the account as deactivated and the
 * server-side session is already closed.
 */
export async function endMobileSession(options: { contactServer?: boolean } = {}): Promise<void> {
  const contactServer = options.contactServer !== false;
  clearMailComposeTransfers();
  chatSocket.disconnect({ reconnect: false, clearSubscriptions: true });
  // A pending deep-link belongs to the outgoing account: the next login must
  // start at its own home route, not inherit the previous session's target.
  clearPendingPortalPath();
  // An unconsumed incoming share belongs to the outgoing account too — the
  // next user must never see its text or receive its files in a composer. The
  // native pending intent is consumed-and-discarded as well: otherwise it
  // would resurface for whoever signs in next on a shared device.
  const shareCleanup = clearIncomingShare().catch(() => undefined);

  try {
    await unregisterMobileBackgroundSync();
  } catch {
    // Local credential cleanup must continue if Android rejects task removal.
  }

  const [accessToken, refreshToken, clientDeviceId, pushToken] = await Promise.all([
    tokenStore.getAccessToken().catch(() => null),
    tokenStore.getRefreshToken().catch(() => null),
    tokenStore.getClientDeviceId().catch(() => null),
    tokenStore.getNativePushToken().catch(() => null),
  ]);

  // Persist the deferred cleanup BEFORE the local wipe and before racing the
  // server: a failed write must never block logout, a successful one survives
  // any later crash so the orphaned session can still be revoked.
  if (contactServer && refreshToken) {
    await rememberPendingLogoutCleanup({ refreshToken, clientDeviceId, pushToken }).catch(() => undefined);
  }

  // Server-side revocation races the local wipe: a hung or captive network must
  // never delay logout — on process kill the session would otherwise resurrect.
  const serverCleanup = contactServer
    ? revokeCapturedSession({ accessToken, refreshToken, clientDeviceId, pushToken })
    : Promise.resolve();
  try {
    clearAttachmentCache();
    clearNativeMailCache();
    clearNativeTaskFileCache();
    clearNativeMyFilesCache();
    clearNativeDocflowCache();
    clearNativeFeedFileCache();
    clearNativeDatabaseFileCache();
    clearNativeKbCache();
    clearNativeWarehouse1cCache();
  } catch {
    // Cache cleanup must not prevent credential revocation.
  }
  await Promise.allSettled([
    clearNativeImageCache(),
    tokenStore.clearTokens({ clearOfflineData: true }),
    disableBiometricLogin(),
    clearOfflineCommandQueue(),
    clearPendingChatReplies(),
    // Delivered tray notifications belong to the outgoing account — they must
    // not preview its chats/mail to whoever picks up the device next.
    dismissDeliveredNotifications().catch(() => undefined),
    clearAllNativeChatDrafts(),
    clearNativeChatOutbox(),
    clearMailQuickReplyDrafts(),
    clearMailComposeDrafts(),
    clearNativeFormDrafts(),
    shareCleanup,
  ]);
  void serverCleanup;
}
