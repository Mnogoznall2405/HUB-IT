import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WINDOWS_NOTIFICATIONS_ENABLED_KEY,
  WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY,
} from '../../lib/windowsNotifications';

const {
  mockHasPermission,
  mockNavigate,
  mockNotifyInfo,
  mockMarkHubNotificationsSeen,
  mockApiGet,
  mockApiPost,
  mockGetChatUnreadSummary,
  mockGetUnreadCount,
  mockGetNotificationFeed,
  mockGetMessages,
  mockMarkMailAsRead,
  mockMarkAllMailRead,
  mockCreateChatSystemNotification,
  mockGetChatNotificationState,
  mockSyncChatPushSubscription,
  mockLocation,
  mockChatSocketRetain,
  mockChatSocketSubscribeInbox,
  mockChatSocketUnsubscribeInbox,
} = vi.hoisted(() => ({
  mockHasPermission: vi.fn(() => true),
  mockNavigate: vi.fn(),
  mockNotifyInfo: vi.fn(),
  mockMarkHubNotificationsSeen: vi.fn(),
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockGetChatUnreadSummary: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockGetNotificationFeed: vi.fn(),
  mockGetMessages: vi.fn(),
  mockMarkMailAsRead: vi.fn(),
  mockMarkAllMailRead: vi.fn(),
  mockCreateChatSystemNotification: vi.fn(),
  mockGetChatNotificationState: vi.fn(),
  mockSyncChatPushSubscription: vi.fn(),
  mockLocation: { pathname: '/dashboard', search: '' },
  mockChatSocketRetain: vi.fn(() => vi.fn()),
  mockChatSocketSubscribeInbox: vi.fn(),
  mockChatSocketUnsubscribeInbox: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  };
});

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'admin' },
    logout: vi.fn(),
    hasPermission: mockHasPermission,
  }),
}));

vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifyApiError: vi.fn(),
    notifyInfo: mockNotifyInfo,
    toastHistory: [],
    clearToastHistory: vi.fn(),
    hasSeenHubNotification: vi.fn(() => false),
    markHubNotificationsSeen: mockMarkHubNotificationsSeen,
  }),
}));

vi.mock('../../api/client', () => ({
  default: {
    get: mockApiGet,
    post: mockApiPost,
  },
  databaseAPI: {
    getAvailableDatabases: async () => (await mockApiGet('/database/list')).data,
    getCurrentDatabase: async () => (await mockApiGet('/database/current')).data,
  },
  chatAPI: {
    getUnreadSummary: mockGetChatUnreadSummary,
  },
  mailAPI: {
    getUnreadCount: mockGetUnreadCount,
    getNotificationFeed: mockGetNotificationFeed,
    getMessages: mockGetMessages,
    markAsRead: mockMarkMailAsRead,
    markAllRead: mockMarkAllMailRead,
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

vi.mock('../../lib/chatSocket', () => ({
  chatSocket: {
    retain: mockChatSocketRetain,
    subscribeInbox: mockChatSocketSubscribeInbox,
    unsubscribeInbox: mockChatSocketUnsubscribeInbox,
  },
  CHAT_SOCKET_MESSAGE_CREATED_EVENT: 'chat-ws-message-created',
  CHAT_SOCKET_STATUS_EVENT: 'chat-ws-status',
  CHAT_SOCKET_UNREAD_SUMMARY_EVENT: 'chat-ws-unread-summary',
}));

vi.mock('../../lib/chatNotifications', () => ({
  buildChatNotificationRoute: ({ conversationId }) => `/chat?conversation=${conversationId}`,
  createChatSystemNotification: mockCreateChatSystemNotification,
  getChatNotificationState: mockGetChatNotificationState,
  refreshChatNotificationState: vi.fn(),
  setChatForegroundDiagnostic: vi.fn(),
  setChatSocketStatus: vi.fn(),
  syncChatPushSubscription: mockSyncChatPushSubscription,
}));

vi.mock('../chat/chatHelpers', () => ({
  getMessagePreview: (message) => String(message?.body || '').trim() || 'Preview',
}));

vi.mock('../../lib/swrCache', () => ({
  getOrFetchSWR: vi.fn(async (_key, fetcher) => ({ data: await fetcher() })),
  buildCacheKey: (...parts) => parts.join(':'),
}));

vi.mock('./ToastHistoryList', () => ({
  default: () => <div data-testid="toast-history-list" />,
}));

import MainLayout from './MainLayout';

function installMatchMedia({ mobile = false } = {}) {
  const previousMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mobile ? query.includes('max-width:599.95px') : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  return () => {
    window.matchMedia = previousMatchMedia;
  };
}

describe('MainLayout hub Windows notifications', () => {
  let visibilityState = 'visible';
  let pollCallCount = 0;
  let notificationPermission = 'granted';
  let notificationInstances = [];

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.localStorage.setItem(WINDOWS_NOTIFICATIONS_ENABLED_KEY, '1');
    window.localStorage.setItem(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY, '1');
    visibilityState = 'hidden';
    pollCallCount = 0;
    notificationPermission = 'granted';
    notificationInstances = [];
    mockHasPermission.mockReset();
    mockHasPermission.mockImplementation(() => true);
    mockNavigate.mockReset();
    mockNotifyInfo.mockReset();
    mockMarkHubNotificationsSeen.mockReset();
    mockApiGet.mockReset();
    mockApiPost.mockReset();
    mockGetChatUnreadSummary.mockReset();
    mockGetUnreadCount.mockReset();
    mockGetNotificationFeed.mockReset();
    mockGetMessages.mockReset();
    mockMarkMailAsRead.mockReset();
    mockMarkAllMailRead.mockReset();
    mockCreateChatSystemNotification.mockReset();
    mockGetChatNotificationState.mockReset();
    mockSyncChatPushSubscription.mockReset();
    mockChatSocketRetain.mockClear();
    mockChatSocketSubscribeInbox.mockClear();
    mockChatSocketUnsubscribeInbox.mockClear();
    mockApiPost.mockResolvedValue({ data: { ok: true } });
    mockGetChatUnreadSummary.mockResolvedValue({ messages_unread_total: 2, conversations_unread: 1 });
    mockGetMessages.mockResolvedValue({
      items: [
        {
          id: 'mail-1',
          subject: 'Unread mail subject',
          sender: 'Boss',
          body_preview: 'Please check',
          received_at: '2026-03-21T11:05:00Z',
          is_read: false,
        },
      ],
    });
    mockMarkMailAsRead.mockResolvedValue({ ok: true });
    mockMarkAllMailRead.mockResolvedValue({ ok: true, count: 1 });
    mockGetChatNotificationState.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: false,
    });
    window.focus = vi.fn();
    mockLocation.pathname = '/dashboard';
    mockLocation.search = '';

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });

    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    class MockNotification {
      constructor(title, options) {
        this.title = title;
        this.options = options;
        this.onclick = null;
        this.close = vi.fn();
        notificationInstances.push(this);
      }
    }

    Object.defineProperty(MockNotification, 'permission', {
      configurable: true,
      get: () => notificationPermission,
    });

    MockNotification.requestPermission = vi.fn(async () => notificationPermission);
    window.Notification = MockNotification;

    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
    mockGetNotificationFeed.mockResolvedValue({
      items: [
        {
          id: 'mail-1',
          subject: 'Unread mail subject',
          sender: 'boss@example.com',
          body_preview: 'Please check',
          received_at: '2026-03-21T11:05:00Z',
          is_read: false,
        },
      ],
      total_unread: 1,
    });
    mockApiGet.mockImplementation(async (url, options = {}) => {
      const params = options?.params || {};
      if (url === '/database/list') {
        return { data: [{ id: 'default', name: 'Основная БД' }] };
      }
      if (url === '/database/current') {
        return { data: { id: 'default', name: 'Основная БД', locked: false } };
      }
      if (url === '/hub/notifications/unread-counts') {
        return {
          data: {
            notifications_unread_total: 0,
            announcements_unread: 0,
            announcements_ack_pending: 0,
            tasks_open_total: 0,
            tasks_open: 0,
            tasks_new: 0,
            tasks_assignee_open: 0,
            tasks_created_open: 0,
            tasks_controller_open: 0,
            tasks_review_required: 0,
            tasks_overdue: 0,
            tasks_with_unread_comments: 0,
          },
        };
      }
      if (url === '/hub/notifications/poll') {
        if (params.unread_only) {
          return {
            data: {
              items: [
                {
                  id: 'hub-unread-1',
                  title: 'Unread hub item',
                  body: 'Still needs attention',
                  entity_type: 'task',
                  entity_id: 'task-2',
                  created_at: '2026-03-21T10:10:00Z',
                  unread: 1,
                },
              ],
              unread_counts: {
                notifications_unread_total: 1,
                announcements_unread: 0,
                announcements_ack_pending: 0,
                tasks_open_total: 1,
                tasks_open: 1,
                tasks_new: 1,
                tasks_assignee_open: 1,
                tasks_created_open: 0,
                tasks_controller_open: 0,
                tasks_review_required: 0,
                tasks_overdue: 0,
                tasks_with_unread_comments: 0,
              },
            },
          };
        }
        pollCallCount += 1;
        return {
          data: {
            items: pollCallCount === 1
              ? [
                {
                  id: 'hub-read-legacy',
                  title: 'Read legacy item',
                  body: 'Should not stay in bell inbox',
                  entity_type: 'task',
                  entity_id: 'task-read',
                  created_at: '2026-03-21T09:55:00Z',
                  unread: 0,
                },
              ]
              : [
                {
                  id: 'hub-1',
                  title: 'Новая задача',
                  body: 'Добавление данных',
                  entity_type: 'task',
                  entity_id: 'task-1',
                  created_at: `2026-03-21T10:00:0${pollCallCount}Z`,
                  unread: 1,
                },
              ],
            unread_counts: {
              notifications_unread_total: 1,
              announcements_unread: 0,
              announcements_ack_pending: 0,
              tasks_open_total: 1,
              tasks_open: 1,
              tasks_new: 1,
              tasks_assignee_open: 1,
              tasks_created_open: 0,
              tasks_controller_open: 0,
              tasks_review_required: 0,
              tasks_overdue: 0,
              tasks_with_unread_comments: 0,
            },
          },
        };
      }
      return { data: {} };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps polling in a hidden tab and opens a deep-linked system notification for new hub items', async () => {
    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiGet).toHaveBeenCalledWith('/hub/notifications/poll', {
      params: {
        since: undefined,
        limit: 20,
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(notificationInstances).toHaveLength(1);
    expect(mockMarkHubNotificationsSeen).toHaveBeenCalledWith(['hub-1']);

    notificationInstances[0].onclick?.();
    expect(window.focus).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/tasks?task=task-1&task_tab=comments');
  }, 10000);

  it('does not poll hub notifications for mail-only users without dashboard access', async () => {
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');

    const view = render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    const requestedUrls = mockApiGet.mock.calls.map(([url]) => url);
    expect(requestedUrls).not.toContain('/hub/notifications/unread-counts');
    expect(requestedUrls).not.toContain('/hub/notifications/poll');
    expect(mockGetChatUnreadSummary).not.toHaveBeenCalled();
    expect(mockGetUnreadCount).toHaveBeenCalled();
  });

  it('hides page title and database selector from the main header on dashboard-like pages', async () => {
    const { container } = render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const appBar = container.querySelector('.MuiAppBar-root');
    expect(appBar).toBeTruthy();
    expect(within(appBar).queryByText('ITINVENT')).toBeNull();
    expect(within(appBar).queryByText('Центр управления')).toBeNull();
    expect(within(appBar).queryByText('Рабочая область')).toBeNull();
    expect(within(appBar).queryByText('Основная БД')).toBeNull();
    expect(within(appBar).queryByRole('combobox')).toBeNull();
  });

  it('keeps page title block and database selector on other pages', async () => {
    mockLocation.pathname = '/database';

    const { container } = render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const appBar = container.querySelector('.MuiAppBar-root');
    expect(appBar).toBeTruthy();
    expect(within(appBar).queryByText('ITINVENT')).not.toBeNull();
    expect(within(appBar).queryByRole('combobox')).not.toBeNull();
  });

  it('keeps polling task notifications for users with tasks access but without dashboard access', async () => {
    mockHasPermission.mockImplementation((permission) => permission === 'tasks.read');

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    const requestedUrls = mockApiGet.mock.calls.map(([url]) => url);
    expect(requestedUrls).toContain('/hub/notifications/poll');
    expect(notificationInstances).toHaveLength(1);
  });

  it('does not refetch mail unread count on the visible mail route during hub poll bursts after the initial sync', async () => {
    visibilityState = 'visible';
    mockLocation.pathname = '/mail';

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);

    mockGetUnreadCount.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiGet).toHaveBeenCalledWith('/hub/notifications/poll', expect.any(Object));
    expect(mockGetUnreadCount).not.toHaveBeenCalled();
  });

  it('shows a chat system notification outside the active visible conversation and suppresses it inside the open chat', async () => {
    const view = render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const incomingDetail = {
      conversation_id: 'conv-2',
      payload: {
        id: 'msg-1',
        conversation_id: 'conv-2',
        body: 'Новое сообщение',
        sender: { full_name: 'Second Person' },
        is_own: false,
      },
    };

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chat-ws-message-created', { detail: incomingDetail }));
      await Promise.resolve();
    });

    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockCreateChatSystemNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateChatSystemNotification).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'msg-1',
      conversationId: 'conv-2',
      title: 'Second Person',
      body: 'Новое сообщение',
    }));

    const foregroundCall = mockCreateChatSystemNotification.mock.calls[0][0];
    foregroundCall.onNavigate('/chat?conversation=conv-2');
    expect(mockNavigate).toHaveBeenCalledWith('/chat?conversation=conv-2');

    mockNotifyInfo.mockClear();
    mockCreateChatSystemNotification.mockClear();
    view.unmount();
    visibilityState = 'visible';
    mockLocation.pathname = '/chat';
    mockLocation.search = '?conversation=conv-2';
    const activeConversationDetail = {
      ...incomingDetail,
      payload: {
        ...incomingDetail.payload,
        id: 'msg-2',
      },
    };

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chat-ws-message-created', { detail: activeConversationDetail }));
      await Promise.resolve();
    });

    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockCreateChatSystemNotification).not.toHaveBeenCalled();
  });

  it('shows unread-only bell inbox items and includes unread mail entries', async () => {
    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByLabelText('Открыть уведомления'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Unread hub item')).toBeTruthy();
    expect(screen.getByText('Unread mail subject')).toBeTruthy();
    expect(screen.queryByText('Read legacy item')).toBeNull();
  });

  it('uses a single in-app mail toast when the app is visible', async () => {
    visibilityState = 'visible';
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');
    mockGetChatNotificationState.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: true,
    });

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    mockGetUnreadCount.mockResolvedValue({ unread_count: 1 });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockNotifyInfo).toHaveBeenCalledWith(
      'Unread mail subject',
      expect.objectContaining({
        title: 'boss@example.com',
        channel: 'mail',
        dedupeKey: 'mail:mail-1',
      }),
    );
    expect(notificationInstances).toHaveLength(0);
  });

  it('does not create a local browser mail notification when push subscription is active in the background', async () => {
    visibilityState = 'hidden';
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');
    mockGetChatNotificationState.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: true,
    });

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    mockGetUnreadCount.mockResolvedValue({ unread_count: 1 });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(notificationInstances).toHaveLength(0);
  });

  it('falls back to a single local browser mail notification without push subscription and dedupes repeated refreshes', async () => {
    visibilityState = 'hidden';
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');
    mockGetChatNotificationState.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: false,
    });

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    mockGetUnreadCount.mockResolvedValue({ unread_count: 1 });

    await act(async () => {
      window.dispatchEvent(new Event('mail-list-refreshed'));
      window.dispatchEvent(new Event('mail-list-refreshed'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].title).toBe('boss@example.com');
    expect(notificationInstances[0].options.body).toBe('Unread mail subject');
  });

  it('shows a browser notification permission banner for users without permission and enables notifications on accept', async () => {
    window.localStorage.removeItem(WINDOWS_NOTIFICATIONS_ENABLED_KEY);
    window.localStorage.removeItem(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY);
    notificationPermission = 'default';
    window.Notification.requestPermission = vi.fn(async () => {
      notificationPermission = 'granted';
      return 'granted';
    });

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Разрешите уведомления браузера, чтобы получать новые задачи, сообщения и почту.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Включить'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.Notification.requestPermission).toHaveBeenCalled();
    expect(window.localStorage.getItem(WINDOWS_NOTIFICATIONS_ENABLED_KEY)).toBe('1');
    expect(window.localStorage.getItem(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY)).toBe('1');
    expect(mockSyncChatPushSubscription).toHaveBeenCalled();
  });

  it('auto-enables hub Windows notifications once when permission is already granted and no explicit choice exists', async () => {
    window.localStorage.removeItem(WINDOWS_NOTIFICATIONS_ENABLED_KEY);
    window.localStorage.removeItem(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY);
    notificationPermission = 'granted';

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(WINDOWS_NOTIFICATIONS_ENABLED_KEY)).toBe('1');
    expect(window.localStorage.getItem(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY)).toBe('1');
  });

  it('marks all bell inbox items as read for hub and mail', async () => {
    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByLabelText('Открыть уведомления'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText('Прочитать все'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiPost).toHaveBeenCalledWith('/hub/notifications/read-all');
    expect(mockMarkAllMailRead).toHaveBeenCalledWith({ folder: 'inbox', folder_scope: 'current' });
  });

  it('opens a mail notification as a deep link and marks it read', async () => {
    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByLabelText('Открыть уведомления'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText('Unread mail subject'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockMarkMailAsRead).toHaveBeenCalledWith('mail-1', '');
    expect(mockNavigate).toHaveBeenCalledWith('/mail?folder=inbox&message=mail-1');
  });

  it('uses edge-to-edge mobile content mode only on phones', async () => {
    mockLocation.pathname = '/mail';
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      const { unmount } = render(
        <MainLayout headerMode="hidden" contentMode="edge-to-edge-mobile">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const mobileMain = screen.getByTestId('main-layout-content');
      expect(mobileMain).toHaveAttribute('data-content-mode', 'edge-to-edge-mobile');
      expect(mobileMain).toHaveAttribute('data-edge-to-edge-mobile', 'true');

      unmount();
    } finally {
      restoreMobileMatchMedia();
    }

    const restoreDesktopMatchMedia = installMatchMedia({ mobile: false });

    try {
      render(
        <MainLayout headerMode="hidden" contentMode="edge-to-edge-mobile">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const desktopMain = screen.getByTestId('main-layout-content');
      expect(desktopMain).toHaveAttribute('data-content-mode', 'edge-to-edge-mobile');
      expect(desktopMain).toHaveAttribute('data-edge-to-edge-mobile', 'false');
    } finally {
      restoreDesktopMatchMedia();
    }
  });
});
