import * as chatApi from '../api/chatApi';
import * as notificationApi from '../api/notificationApi';
import {
  clearNativeUnreadSnapshotCacheForTests,
  getNativeUnreadSnapshot,
  nativeUnreadTotal,
} from './nativeUnreadSnapshot';

jest.mock('../api/chatApi', () => ({ getUnreadSummary: jest.fn() }));
jest.mock('../api/notificationApi', () => ({
  getNotificationUnreadCounts: jest.fn(),
  getMailUnreadSnapshot: jest.fn(),
}));

beforeEach(() => {
  clearNativeUnreadSnapshotCacheForTests();
  jest.mocked(notificationApi.getNotificationUnreadCounts).mockResolvedValue({
    notifications_unread_total: 2,
    announcements_unread: 1,
    tasks_open_total: 4,
  });
  jest.mocked(chatApi.getUnreadSummary).mockResolvedValue({
    messages_unread_total: 5,
    conversations_unread: 2,
  });
  jest.mocked(notificationApi.getMailUnreadSnapshot).mockResolvedValue({
    unread_count: 4,
    state: 'ok',
  });
});

it('shares one bootstrap snapshot between navigation and Android badge consumers', async () => {
  const first = await getNativeUnreadSnapshot();
  const second = await getNativeUnreadSnapshot();

  expect(first).toEqual(second);
  expect(notificationApi.getNotificationUnreadCounts).toHaveBeenCalledTimes(1);
  expect(chatApi.getUnreadSummary).toHaveBeenCalledTimes(1);
  expect(notificationApi.getMailUnreadSnapshot).toHaveBeenCalledTimes(1);
  expect(nativeUnreadTotal(first)).toBe(12);
});

it('bypasses the short bootstrap cache for explicit event refreshes', async () => {
  await getNativeUnreadSnapshot();
  await getNativeUnreadSnapshot({ force: true });

  expect(notificationApi.getNotificationUnreadCounts).toHaveBeenCalledTimes(2);
  expect(chatApi.getUnreadSummary).toHaveBeenCalledTimes(2);
  expect(notificationApi.getMailUnreadSnapshot).toHaveBeenCalledTimes(2);
});

it('does not request unavailable modules and falls back to Hub counters', async () => {
  jest.mocked(notificationApi.getNotificationUnreadCounts).mockResolvedValueOnce({
    notifications_unread_total: 2,
    announcements_unread: 1,
    chat_messages_unread_total: 3,
    mail_unread: 6,
    mail_state: 'ok',
  });

  const snapshot = await getNativeUnreadSnapshot({
    canReadChat: false,
    canReadMail: false,
  });

  expect(chatApi.getUnreadSummary).not.toHaveBeenCalled();
  expect(notificationApi.getMailUnreadSnapshot).not.toHaveBeenCalled();
  expect(snapshot.chat_messages_unread_total).toBe(3);
  expect(snapshot.mail_unread).toBe(6);
});
