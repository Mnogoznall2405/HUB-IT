import apiClient from './client';
import {
  getMailUnreadCount,
  getMailUnreadSnapshot,
  getMailNotificationFeed,
  getNotificationUnreadCounts,
  markAllHubNotificationsRead,
  markAllMailNotificationsRead,
  markHubNotificationRead,
  pollHubNotifications,
} from './notificationApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedClient = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
};

describe('notificationApi inbox contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the unread HUB inbox with bounded parameters', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{ id: 'n1', title: 'Задача', unread: 1 }],
        unread_counts: { notifications_unread_total: 4 },
        limit: 100,
        unread_only: true,
      },
    });

    await expect(pollHubNotifications({ limit: 999, unreadOnly: true })).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ id: 'n1' })],
        unread_counts: { notifications_unread_total: 4 },
        limit: 100,
        unread_only: true,
      }),
    );
    expect(mockedClient.get).toHaveBeenCalledWith('/hub/notifications/poll', {
      params: { limit: 200, unread_only: true },
    });
  });

  it('coalesces concurrent navigation and badge unread requests', async () => {
    let resolveHub: ((value: { data: { notifications_unread_total: number } }) => void) | undefined;
    let resolveMail: ((value: { data: { unread_count: number; state: string } }) => void) | undefined;
    mockedClient.get
      .mockReturnValueOnce(new Promise((resolve) => { resolveHub = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveMail = resolve; }));

    const hubRequests = [getNotificationUnreadCounts(), getNotificationUnreadCounts()];
    const mailRequests = [getMailUnreadSnapshot(), getMailUnreadCount()];

    expect(mockedClient.get).toHaveBeenCalledTimes(2);
    resolveHub?.({ data: { notifications_unread_total: 3 } });
    resolveMail?.({ data: { unread_count: 5, state: 'ok' } });
    await expect(Promise.all(hubRequests)).resolves.toEqual([
      { notifications_unread_total: 3 },
      { notifications_unread_total: 3 },
    ]);
    await expect(Promise.all(mailRequests)).resolves.toEqual([
      { unread_count: 5, state: 'ok', as_of: null },
      5,
    ]);
  });

  it('marks one and all HUB notifications read', async () => {
    mockedClient.post
      .mockResolvedValueOnce({ data: { ok: true } })
      .mockResolvedValueOnce({ data: { marked_count: 7 } });

    await markHubNotificationRead('notice/7');
    await expect(markAllHubNotificationsRead()).resolves.toBe(7);
    expect(mockedClient.post).toHaveBeenNthCalledWith(
      1,
      '/hub/notifications/notice%2F7/read',
    );
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/hub/notifications/read-all');
  });

  it('loads mail feed and marks the inbox read using the web contract', async () => {
    mockedClient.get.mockResolvedValue({
      data: { items: [{ id: 'm1', subject: 'Проверка' }], total_unread: 3, limit: 20 },
    });
    mockedClient.post
      .mockResolvedValueOnce({ data: { changed: 2 } })
      .mockResolvedValueOnce({ data: { changed: 1 } });

    await expect(getMailNotificationFeed(20)).resolves.toEqual(expect.objectContaining({
      total_unread: 3,
      items: [expect.objectContaining({ id: 'm1' })],
    }));
    await expect(markAllMailNotificationsRead(['box-1', 'box-2', 'box-1'])).resolves.toBe(3);
    expect(mockedClient.get).toHaveBeenCalledWith('/mail/notifications/feed', {
      params: { limit: 20 },
    });
    expect(mockedClient.post).toHaveBeenNthCalledWith(1, '/mail/messages/mark-all-read', {
      mailbox_id: 'box-1', folder: 'inbox', folder_scope: 'current',
    });
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/mail/messages/mark-all-read', {
      mailbox_id: 'box-2', folder: 'inbox', folder_scope: 'current',
    });
  });
});
