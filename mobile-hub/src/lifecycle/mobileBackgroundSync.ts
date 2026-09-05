import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import * as tokenStore from '../auth/tokenStore';
import { syncNativePushToken } from '../notifications/nativePush';
import { showReplyFailed, showReplySent } from '../notifications/notificationActionFeedback';
import { reconcileNativeBadge } from '../notifications/notificationBadge';
import { drainPendingChatReplies } from '../notifications/pendingNotificationReplies';
import { drainOfflineCommandQueue } from '../offline/offlineCommandQueue';
import { refreshStaleNativeOfflineData } from '../offline/nativeOfflineBackgroundRefresh';
import { refreshNativeReadCaches } from '../offline/nativeReadCacheRefresh';

export const HUBIT_MOBILE_BACKGROUND_SYNC_TASK = 'hubit-mobile-background-sync-v1';

export async function syncPendingNotificationReplies(userId: number): Promise<number> {
  const result = await drainPendingChatReplies(userId);
  await Promise.all(result.sent.map((item) => showReplySent(item)));
  await Promise.all(result.discarded.map((item) => showReplyFailed(item)));
  return result.remaining;
}

export async function runMobileBackgroundSync(): Promise<BackgroundTask.BackgroundTaskResult> {
  const userId = await tokenStore.getSessionUserId();
  if (!userId) return BackgroundTask.BackgroundTaskResult.Success;
  try {
    const cachedUser = await tokenStore.getCachedSessionUser().catch(() => null);
    await syncPendingNotificationReplies(userId);
    await drainOfflineCommandQueue(userId);
    await syncNativePushToken({ requestPermission: false });
    await reconcileNativeBadge();
    if (cachedUser?.id === userId) {
      await refreshNativeReadCaches({
        userId,
        permissions: cachedUser.permissions || [],
      }).catch(() => undefined);
      await refreshStaleNativeOfflineData({
        userId,
        permissions: cachedUser.permissions || [],
        isAdmin: String(cachedUser.role || '').trim().toLowerCase() === 'admin',
      }).catch(() => undefined);
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

if (!TaskManager.isTaskDefined(HUBIT_MOBILE_BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(HUBIT_MOBILE_BACKGROUND_SYNC_TASK, runMobileBackgroundSync);
}

export async function ensureMobileBackgroundSyncRegistered(): Promise<boolean> {
  if (Platform.OS !== 'android' || !await TaskManager.isAvailableAsync()) return false;
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  if (!await TaskManager.isTaskRegisteredAsync(HUBIT_MOBILE_BACKGROUND_SYNC_TASK)) {
    await BackgroundTask.registerTaskAsync(HUBIT_MOBILE_BACKGROUND_SYNC_TASK, {
      minimumInterval: 15,
    });
  }
  return true;
}

export async function unregisterMobileBackgroundSync(): Promise<void> {
  if (Platform.OS !== 'android' || !await TaskManager.isAvailableAsync()) return;
  if (await TaskManager.isTaskRegisteredAsync(HUBIT_MOBILE_BACKGROUND_SYNC_TASK)) {
    await BackgroundTask.unregisterTaskAsync(HUBIT_MOBILE_BACKGROUND_SYNC_TASK);
  }
}
