import * as BackgroundTask from 'expo-background-task';
import * as tokenStore from '../auth/tokenStore';
import { syncNativePushToken } from '../notifications/nativePush';
import { reconcileNativeBadge } from '../notifications/notificationBadge';
import { drainPendingChatReplies } from '../notifications/pendingNotificationReplies';
import { drainOfflineCommandQueue } from '../offline/offlineCommandQueue';
import { runMobileBackgroundSync } from './mobileBackgroundSync';

jest.mock('../notifications/nativePush', () => ({
  syncNativePushToken: jest.fn(async () => ({ status: 'registered', message: 'ok' })),
}));
jest.mock('../notifications/notificationBadge', () => ({
  reconcileNativeBadge: jest.fn(async () => 0),
}));
jest.mock('../notifications/pendingNotificationReplies', () => ({
  drainPendingChatReplies: jest.fn(async () => ({ remaining: 0, sent: [], discarded: [] })),
}));
jest.mock('../offline/offlineCommandQueue', () => ({
  drainOfflineCommandQueue: jest.fn(async () => 0),
}));
jest.mock('../notifications/notificationActionFeedback', () => ({
  showReplySent: jest.fn(async () => undefined),
  showReplyFailed: jest.fn(async () => undefined),
}));

it('uses the active session owner and runs only safe background synchronization', async () => {
  jest.spyOn(tokenStore, 'getSessionUserId').mockResolvedValueOnce(7);

  await expect(runMobileBackgroundSync()).resolves.toBe(BackgroundTask.BackgroundTaskResult.Success);

  expect(drainPendingChatReplies).toHaveBeenCalledWith(7);
  expect(drainOfflineCommandQueue).toHaveBeenCalledWith(7);
  expect(syncNativePushToken).toHaveBeenCalledWith({ requestPermission: false });
  expect(reconcileNativeBadge).toHaveBeenCalledTimes(1);
});
