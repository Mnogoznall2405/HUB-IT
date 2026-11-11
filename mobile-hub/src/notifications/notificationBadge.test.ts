import * as Notifications from 'expo-notifications';
import * as chatApi from '../api/chatApi';
import * as notificationApi from '../api/notificationApi';
import { reconcileNativeBadge, resolveNativeUnreadCount } from './notificationBadge';
import { clearNativeUnreadSnapshotCacheForTests } from './nativeUnreadSnapshot';

jest.mock('../api/chatApi', () => ({
  getConversations: jest.fn(),
  getUnreadSummary: jest.fn(),
}));
jest.mock('../api/notificationApi', () => ({
  getNotificationUnreadCounts: jest.fn(),
  getMailUnreadSnapshot: jest.fn(),
}));

beforeEach(() => {
  clearNativeUnreadSnapshotCacheForTests();
  (notificationApi.getNotificationUnreadCounts as jest.Mock).mockResolvedValue({
    notifications_unread_total: 2,
    announcements_unread: 1,
  });
  (notificationApi.getMailUnreadSnapshot as jest.Mock).mockResolvedValue({
    unread_count: 4,
    state: 'ok',
  });
  (chatApi.getConversations as jest.Mock).mockResolvedValue([
    { unread_count: 3 },
    { unread_count: 2 },
  ]);
  (chatApi.getUnreadSummary as jest.Mock).mockResolvedValue({
    messages_unread_total: 5,
    conversations_unread: 2,
  });
});

it('aggregates Hub, mail and Chat unread counters', async () => {
  await expect(resolveNativeUnreadCount()).resolves.toBe(12);
});

it('uses the lightweight Chat unread summary instead of loading every dialog', async () => {
  await resolveNativeUnreadCount();
  expect(chatApi.getUnreadSummary).toHaveBeenCalledTimes(1);
  expect(chatApi.getConversations).not.toHaveBeenCalled();
});

it('updates the Android launcher badge', async () => {
  await expect(reconcileNativeBadge()).resolves.toBe(12);
  expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(12);
});

it('does not clear a known badge when every source is unavailable', async () => {
  (notificationApi.getNotificationUnreadCounts as jest.Mock).mockRejectedValue(new Error('offline'));
  (notificationApi.getMailUnreadSnapshot as jest.Mock).mockRejectedValue(new Error('offline'));
  (chatApi.getUnreadSummary as jest.Mock).mockRejectedValue(new Error('offline'));
  await expect(reconcileNativeBadge()).resolves.toBeNull();
  expect(Notifications.setBadgeCountAsync).not.toHaveBeenCalled();
});
