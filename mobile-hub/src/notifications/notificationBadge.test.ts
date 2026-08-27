import * as Notifications from 'expo-notifications';
import * as chatApi from '../api/chatApi';
import * as notificationApi from '../api/notificationApi';
import { reconcileNativeBadge, resolveNativeUnreadCount } from './notificationBadge';

jest.mock('../api/chatApi', () => ({ getConversations: jest.fn() }));
jest.mock('../api/notificationApi', () => ({
  getNotificationUnreadCounts: jest.fn(),
  getMailUnreadCount: jest.fn(),
}));

beforeEach(() => {
  (notificationApi.getNotificationUnreadCounts as jest.Mock).mockResolvedValue({
    notifications_unread_total: 2,
    announcements_unread: 1,
  });
  (notificationApi.getMailUnreadCount as jest.Mock).mockResolvedValue(4);
  (chatApi.getConversations as jest.Mock).mockResolvedValue([
    { unread_count: 3 },
    { unread_count: 2 },
  ]);
});

it('aggregates Hub, mail and Chat unread counters', async () => {
  await expect(resolveNativeUnreadCount()).resolves.toBe(12);
});

it('updates the Android launcher badge', async () => {
  await expect(reconcileNativeBadge()).resolves.toBe(12);
  expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(12);
});

it('does not clear a known badge when every source is unavailable', async () => {
  (notificationApi.getNotificationUnreadCounts as jest.Mock).mockRejectedValue(new Error('offline'));
  (notificationApi.getMailUnreadCount as jest.Mock).mockRejectedValue(new Error('offline'));
  (chatApi.getConversations as jest.Mock).mockRejectedValue(new Error('offline'));
  await expect(reconcileNativeBadge()).resolves.toBeNull();
  expect(Notifications.setBadgeCountAsync).not.toHaveBeenCalled();
});
