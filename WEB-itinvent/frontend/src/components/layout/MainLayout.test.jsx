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
  mockToastHistory,
  mockClearToastHistory,
  mockMarkHubNotificationsSeen,
  mockApiGet,
  mockApiPost,
  mockGetChatUnreadSummary,
  mockGetUnreadCount,
  mockGetNotificationFeed,
  mockGetMessages,
  mockMarkMailAsRead,
  mockMarkAllMailRead,
  mockGetNotificationPreferences,
  mockCreateChatSystemNotification,
  mockGetChatNotificationState,
  mockSyncChatPushSubscription,
  mockClaimChatMessageNotification,
  mockShouldSkipChatPushForegroundNotification,
  mockLocation,
  mockChatSocketRetain,
  mockChatSocketSubscribeInbox,
  mockChatSocketUnsubscribeInbox,
  mockChatSocketGetConnectionState,
  mockPreferences,
} = vi.hoisted(() => ({
  mockHasPermission: vi.fn(() => true),
  mockNavigate: vi.fn(),
  mockNotifyInfo: vi.fn(),
  mockToastHistory: [],
  mockClearToastHistory: vi.fn(),
  mockMarkHubNotificationsSeen: vi.fn(),
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockGetChatUnreadSummary: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockGetNotificationFeed: vi.fn(),
  mockGetMessages: vi.fn(),
  mockMarkMailAsRead: vi.fn(),
  mockMarkAllMailRead: vi.fn(),
  mockGetNotificationPreferences: vi.fn(),
  mockCreateChatSystemNotification: vi.fn(),
  mockGetChatNotificationState: vi.fn(),
  mockSyncChatPushSubscription: vi.fn(),
  mockClaimChatMessageNotification: vi.fn((messageId) => Boolean(String(messageId || '').trim())),
  mockShouldSkipChatPushForegroundNotification: vi.fn(() => false),
  mockLocation: { pathname: '/dashboard', search: '' },
  mockChatSocketRetain: vi.fn(() => vi.fn()),
  mockChatSocketSubscribeInbox: vi.fn(),
  mockChatSocketUnsubscribeInbox: vi.fn(),
  mockChatSocketGetConnectionState: vi.fn(() => 'disconnected'),
  mockPreferences: {
    mobile_bottom_nav_items: ['/dashboard', '/tasks', '/chat', '/mail'],
  },
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
    toastHistory: mockToastHistory,
    clearToastHistory: mockClearToastHistory,
    hasSeenHubNotification: vi.fn(() => false),
    markHubNotificationsSeen: mockMarkHubNotificationsSeen,
  }),
}));

vi.mock('../../contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
  }),
}));

vi.mock('../../api/client', () => ({
  default: {
    get: mockApiGet,
    post: mockApiPost,
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
  settingsAPI: {
    getNotificationPreferences: mockGetNotificationPreferences,
  },
}));

vi.mock('../../api/database', () => ({
  databaseAPI: {
    getAvailableDatabases: async () => (await mockApiGet('/database/list')).data,
    getCurrentDatabase: async () => (await mockApiGet('/database/current')).data,
    switchDatabase: async (databaseId) => (await mockApiPost('/database/switch', { database_id: databaseId })).data,
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
  TASK_DISCUSSION_CHAT_ENABLED: false,
}));

vi.mock('../../lib/chatSocket', () => ({
  chatSocket: {
    retain: mockChatSocketRetain,
    subscribeInbox: mockChatSocketSubscribeInbox,
    unsubscribeInbox: mockChatSocketUnsubscribeInbox,
    getConnectionState: mockChatSocketGetConnectionState,
  },
  CHAT_SOCKET_MESSAGE_CREATED_EVENT: 'chat-ws-message-created',
  CHAT_SOCKET_STATUS_EVENT: 'chat-ws-status',
  CHAT_SOCKET_UNREAD_SUMMARY_EVENT: 'chat-ws-unread-summary',
}));

vi.mock('../../lib/chatNotifications', () => ({
  buildChatNotificationRoute: ({ conversationId }) => `/chat?conversation=${conversationId}`,
  claimChatMessageNotification: mockClaimChatMessageNotification,
  createChatSystemNotification: mockCreateChatSystemNotification,
  getChatNotificationState: mockGetChatNotificationState,
  refreshChatNotificationState: vi.fn(),
  setChatForegroundDiagnostic: vi.fn(),
  setChatSocketStatus: vi.fn(),
  shouldDeliverExternalChatViaPushOnly: vi.fn((state) => Boolean(state?.backgroundCapable || state?.pushSubscribed)),
  shouldSkipChatPushForegroundNotification: mockShouldSkipChatPushForegroundNotification,
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

const HUB_POLL_UNREAD_COUNTS = {
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
};

const HUB_POLL_NEW_ITEM = {
  id: 'hub-1',
  title: 'Новая задача',
  body: 'Добавление данных',
  entity_type: 'task',
  entity_id: 'task-1',
  created_at: '2026-03-21T10:00:02Z',
  unread: 1,
};

const HUB_POLL_LEGACY_ITEM = {
  id: 'hub-read-legacy',
  title: 'Read legacy item',
  body: 'Should not stay in bell inbox',
  entity_type: 'task',
  entity_id: 'task-read',
  created_at: '2026-03-21T09:55:00Z',
  unread: 0,
};

function installHubPollSequenceMock() {
  let pollCalls = 0;

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
          ...HUB_POLL_UNREAD_COUNTS,
          notifications_unread_total: 0,
        },
      };
    }
    if (url === '/hub/notifications/poll') {
      if (params.unread_only) {
        return {
          data: {
            items: [HUB_POLL_NEW_ITEM],
            unread_counts: HUB_POLL_UNREAD_COUNTS,
          },
        };
      }
      pollCalls += 1;
      return {
        data: {
          items: pollCalls >= 2 ? [HUB_POLL_NEW_ITEM] : [HUB_POLL_LEGACY_ITEM],
          unread_counts: HUB_POLL_UNREAD_COUNTS,
        },
      };
    }
    return { data: {} };
  });
}

async function advanceHubPollInterval() {
  await act(async () => {
    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function installMatchMedia({ mobile = false, windowControlsOverlay = false } = {}) {
  const previousMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: Boolean(
      (mobile && query.includes('max-width:599.95px'))
      || (windowControlsOverlay && query.includes('display-mode: window-controls-overlay')),
    ),
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

function mockElementHeightsByTestId(heightsByTestId) {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
    const testId = this.getAttribute?.('data-testid');
    const height = heightsByTestId[testId];
    if (height !== undefined) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: height,
        width: 0,
        height,
        toJSON: () => ({}),
      };
    }
    return originalGetBoundingClientRect.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  };
}

describe('MainLayout hub Windows notifications', () => {
  let visibilityState = 'visible';
  let notificationPermission = 'granted';
  let notificationInstances = [];

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.localStorage.setItem(WINDOWS_NOTIFICATIONS_ENABLED_KEY, '1');
    window.localStorage.setItem(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY, '1');
    visibilityState = 'hidden';
    notificationPermission = 'granted';
    notificationInstances = [];
    mockHasPermission.mockReset();
    mockHasPermission.mockImplementation(() => true);
    mockNavigate.mockReset();
    mockNotifyInfo.mockReset();
    mockToastHistory.length = 0;
    mockClearToastHistory.mockReset();
    mockMarkHubNotificationsSeen.mockReset();
    mockApiGet.mockReset();
    mockApiPost.mockReset();
    mockGetChatUnreadSummary.mockReset();
    mockGetUnreadCount.mockReset();
    mockGetNotificationFeed.mockReset();
    mockGetMessages.mockReset();
    mockMarkMailAsRead.mockReset();
    mockMarkAllMailRead.mockReset();
    mockGetNotificationPreferences.mockReset();
    mockCreateChatSystemNotification.mockReset();
    mockGetChatNotificationState.mockReset();
    mockClaimChatMessageNotification.mockReset();
    mockShouldSkipChatPushForegroundNotification.mockReset();
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
    mockGetNotificationPreferences.mockResolvedValue({
      channels: {
        mail: true,
        tasks: true,
        announcements: true,
        chat: true,
      },
    });
    mockGetChatNotificationState.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: false,
      socketStatus: 'unknown',
    });
    mockClaimChatMessageNotification.mockImplementation((messageId) => Boolean(String(messageId || '').trim()));
    mockShouldSkipChatPushForegroundNotification.mockReturnValue(false);
    window.focus = vi.fn();
    mockLocation.pathname = '/dashboard';
    mockLocation.search = '';

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });

    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.Audio = vi.fn().mockImplementation(() => ({
      play: vi.fn().mockResolvedValue(undefined),
    }));

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
        if (params.since) {
          return {
            data: {
              items: [
                {
                  id: 'hub-1',
                  title: 'Новая задача',
                  body: 'Добавление данных',
                  entity_type: 'task',
                  entity_id: 'task-1',
                  created_at: '2026-03-21T10:00:02Z',
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
        return {
          data: {
            items: [
              {
                id: 'hub-read-legacy',
                title: 'Read legacy item',
                body: 'Should not stay in bell inbox',
                entity_type: 'task',
                entity_id: 'task-read',
                created_at: '2026-03-21T09:55:00Z',
                unread: 0,
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
    installHubPollSequenceMock();

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

    await advanceHubPollInterval();

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

  it('keeps page title block without database selector on other pages', async () => {
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
    expect(within(appBar).queryByText('HUB-IT')).toBeNull();
    expect(within(appBar).queryByText('Инвентарь')).not.toBeNull();
    expect(within(appBar).queryByRole('combobox')).toBeNull();
  });

  it('keeps polling task notifications for users with tasks access but without dashboard access', async () => {
    mockHasPermission.mockImplementation((permission) => permission === 'tasks.read');
    installHubPollSequenceMock();

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await advanceHubPollInterval();

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

  it('does not create a local chat notification when push can deliver it externally', async () => {
    visibilityState = 'hidden';
    mockGetChatNotificationState.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: true,
      backgroundCapable: true,
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

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chat-ws-message-created', {
        detail: {
          conversation_id: 'conv-2',
          payload: {
            id: 'msg-push-only',
            conversation_id: 'conv-2',
            body: 'Push only',
            sender: { full_name: 'Sender' },
            is_own: false,
          },
        },
      }));
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

  it('does not show toast history in the notification center or badge', async () => {
    mockToastHistory.push(
      {
        id: 'toast-chat-1',
        severity: 'info',
        source: 'chat',
        title: 'Stored chat toast',
        message: 'Read chat toast should stay out',
        lastSeenAt: '2026-03-21T12:00:00Z',
      },
      {
        id: 'toast-mail-1',
        severity: 'info',
        source: 'mail',
        title: 'Stored mail toast',
        message: 'Read mail toast should stay out',
        lastSeenAt: '2026-03-21T12:01:00Z',
      },
    );
    mockGetNotificationFeed.mockResolvedValue({ items: [], total_unread: 0 });
    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
    mockApiGet.mockImplementation(async (url, options = {}) => {
      const params = options?.params || {};
      if (url === '/database/list') {
        return { data: [{ id: 'default', name: 'РћСЃРЅРѕРІРЅР°СЏ Р‘Р”' }] };
      }
      if (url === '/database/current') {
        return { data: { id: 'default', name: 'РћСЃРЅРѕРІРЅР°СЏ Р‘Р”', locked: false } };
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
      if (url === '/hub/notifications/poll' && params.unread_only) {
        return { data: { items: [], unread_counts: { notifications_unread_total: 0 } } };
      }
      if (url === '/hub/notifications/poll') {
        return { data: { items: [], unread_counts: { notifications_unread_total: 0 } } };
      }
      return { data: {} };
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

    expect(screen.queryByText('2')).toBeNull();

    fireEvent.click(screen.getByLabelText('Открыть уведомления'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Нет непрочитанных уведомлений')).toBeTruthy();
    expect(screen.queryByText('Stored chat toast')).toBeNull();
    expect(screen.queryByText('Stored mail toast')).toBeNull();
    expect(screen.queryByText('Read chat toast should stay out')).toBeNull();
    expect(screen.queryByText('Read mail toast should stay out')).toBeNull();
  });

  it('refreshes unread hub notifications from the chat route and hides read chat items', async () => {
    visibilityState = 'visible';
    mockLocation.pathname = '/chat';
    mockLocation.search = '?conversation=conv-1';
    mockGetNotificationFeed.mockResolvedValue({ items: [], total_unread: 0 });
    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
    mockApiGet.mockImplementation(async (url, options = {}) => {
      const params = options?.params || {};
      if (url === '/database/list') {
        return { data: [{ id: 'default', name: 'РћСЃРЅРѕРІРЅР°СЏ Р‘Р”' }] };
      }
      if (url === '/database/current') {
        return { data: { id: 'default', name: 'РћСЃРЅРѕРІРЅР°СЏ Р‘Р”', locked: false } };
      }
      if (url === '/hub/notifications/unread-counts') {
        return {
          data: {
            notifications_unread_total: 1,
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
      if (url === '/hub/notifications/poll' && params.unread_only) {
        return {
          data: {
            items: [
              {
                id: 'chat-read-1',
                title: 'Already read chat item',
                body: 'Old chat body',
                entity_type: 'chat',
                entity_id: 'conv-1',
                event_type: 'chat.message_received',
                created_at: '2026-03-21T10:00:00Z',
                unread: 0,
              },
              {
                id: 'chat-unread-1',
                title: 'Unread chat item',
                body: 'New chat body',
                entity_type: 'chat',
                entity_id: 'conv-2',
                event_type: 'chat.message_received',
                created_at: '2026-03-21T10:01:00Z',
                unread: 1,
              },
            ],
            unread_counts: { notifications_unread_total: 1 },
          },
        };
      }
      if (url === '/hub/notifications/poll') {
        return { data: { items: [], unread_counts: { notifications_unread_total: 1 } } };
      }
      return { data: {} };
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

    fireEvent.click(screen.getByLabelText('Открыть уведомления'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiGet).toHaveBeenCalledWith('/hub/notifications/poll', expect.objectContaining({
      params: expect.objectContaining({ unread_only: true }),
    }));
    expect(screen.getByText('Unread chat item')).toBeTruthy();
    expect(screen.queryByText('Already read chat item')).toBeNull();
  });

  it('refreshes an open notification center when chat unread state changes', async () => {
    let hubUnreadItems = [
      {
        id: 'chat-unread-1',
        title: 'Chat item before read',
        body: 'Needs reading',
        entity_type: 'chat',
        entity_id: 'conv-1',
        event_type: 'chat.message_received',
        created_at: '2026-03-21T10:00:00Z',
        unread: 1,
      },
    ];
    let hubUnreadTotal = 1;
    mockGetNotificationFeed.mockResolvedValue({ items: [], total_unread: 0 });
    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
    mockApiGet.mockImplementation(async (url, options = {}) => {
      const params = options?.params || {};
      if (url === '/database/list') {
        return { data: [{ id: 'default', name: 'РћСЃРЅРѕРІРЅР°СЏ Р‘Р”' }] };
      }
      if (url === '/database/current') {
        return { data: { id: 'default', name: 'РћСЃРЅРѕРІРЅР°СЏ Р‘Р”', locked: false } };
      }
      if (url === '/hub/notifications/unread-counts') {
        return {
          data: {
            notifications_unread_total: hubUnreadTotal,
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
      if (url === '/hub/notifications/poll' && params.unread_only) {
        return { data: { items: hubUnreadItems, unread_counts: { notifications_unread_total: hubUnreadTotal } } };
      }
      if (url === '/hub/notifications/poll') {
        return { data: { items: [], unread_counts: { notifications_unread_total: hubUnreadTotal } } };
      }
      return { data: {} };
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

    fireEvent.click(screen.getByLabelText('Открыть уведомления'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Chat item before read')).toBeTruthy();

    hubUnreadItems = [];
    hubUnreadTotal = 0;

    await act(async () => {
      window.dispatchEvent(new CustomEvent('chat-unread-needs-refresh'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText('Chat item before read')).toBeNull();
    expect(screen.getByText('Нет непрочитанных уведомлений')).toBeTruthy();
  });

  it('refreshes an open notification center when mail read state changes', async () => {
    let mailItems = [
      {
        id: 'mail-1',
        subject: 'Mail item before read',
        sender: 'boss@example.com',
        body_preview: 'Please check',
        received_at: '2026-03-21T11:05:00Z',
        is_read: false,
      },
    ];
    let mailUnreadCount = 1;
    mockGetUnreadCount.mockImplementation(async () => ({ unread_count: mailUnreadCount }));
    mockGetNotificationFeed.mockImplementation(async () => ({
      items: mailItems,
      total_unread: mailUnreadCount,
    }));
    mockApiGet.mockImplementation(async (url, options = {}) => {
      const params = options?.params || {};
      if (url === '/database/list') {
        return { data: [{ id: 'default', name: 'РћСЃРЅРѕРІРЅР°СЏ Р‘Р”' }] };
      }
      if (url === '/database/current') {
        return { data: { id: 'default', name: 'РћСЃРЅРѕРІРЅР°СЏ Р‘Р”', locked: false } };
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
      if (url === '/hub/notifications/poll' && params.unread_only) {
        return { data: { items: [], unread_counts: { notifications_unread_total: 0 } } };
      }
      if (url === '/hub/notifications/poll') {
        return { data: { items: [], unread_counts: { notifications_unread_total: 0 } } };
      }
      return { data: {} };
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

    fireEvent.click(screen.getByLabelText('Открыть уведомления'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Mail item before read')).toBeTruthy();

    mailItems = [];
    mailUnreadCount = 0;

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mail-read'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText('Mail item before read')).toBeNull();
    expect(screen.getByText('Нет непрочитанных уведомлений')).toBeTruthy();
  });

  it('applies an optimistic mail unread delta without rereading a stale snapshot', async () => {
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');
    mockGetUnreadCount.mockResolvedValue({
      unread_count: 1,
      state: 'ok',
      source: 'app_snapshot',
      as_of: '2026-07-15T05:00:00+00:00',
    });

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const mailNavigation = screen.getByTestId('main-layout-sidebar-mail');
    expect(mailNavigation.querySelector('.MuiBadge-badge')?.textContent).toBe('1');
    const callsBeforeRead = mockGetUnreadCount.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mail-read', {
        detail: {
          phase: 'optimistic',
          mode: 'messages',
          targetId: 'mail-1',
          unreadDelta: -1,
          nextIsRead: true,
        },
      }));
      window.dispatchEvent(new CustomEvent('mail-read', {
        detail: {
          phase: 'confirmed',
          mode: 'messages',
          targetId: 'mail-1',
          unreadDelta: 0,
          nextIsRead: true,
        },
      }));
      await Promise.resolve();
    });

    expect(mailNavigation.querySelector('.MuiBadge-badge')).toBeNull();
    expect(mockGetUnreadCount).toHaveBeenCalledTimes(callsBeforeRead);
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
      await vi.advanceTimersByTimeAsync(100_000);
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

  it('uses the first mail unread count as a baseline without replaying existing unread messages', async () => {
    visibilityState = 'visible';
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');
    mockGetUnreadCount.mockResolvedValue({ unread_count: 1 });

    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(notificationInstances).toHaveLength(0);
  });

  it('creates a local browser mail notification when the push subscription is not background-capable', async () => {
    visibilityState = 'hidden';
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');
    mockGetChatNotificationState.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: true,
      backgroundCapable: false,
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
      await vi.advanceTimersByTimeAsync(100_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].title).toBe('boss@example.com');
  });

  it('does not create a local browser mail notification when background push can deliver it', async () => {
    visibilityState = 'hidden';
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');
    mockGetChatNotificationState.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: true,
      backgroundCapable: true,
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

  it('does not create a local browser mail notification when the mail channel is disabled', async () => {
    visibilityState = 'hidden';
    mockHasPermission.mockImplementation((permission) => permission === 'mail.access');
    mockGetNotificationPreferences.mockResolvedValue({
      channels: {
        mail: false,
        tasks: true,
        announcements: true,
        chat: true,
      },
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

  it('creates a measured top spacer for the fixed header', async () => {
    render(
      <MainLayout>
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const shell = screen.getByTestId('main-layout-shell');
    const spacer = screen.getByTestId('main-layout-top-spacer');

    expect(screen.getByTestId('main-layout-app-bar')).toBeInTheDocument();
    expect(spacer).toHaveStyle({ height: 'var(--app-shell-top-offset)' });
    expect(shell.style.getPropertyValue('--app-shell-top-offset')).toBe(
      'calc(var(--app-shell-safe-top-offset) + var(--app-shell-banner-offset) + var(--app-shell-measured-header-offset))',
    );
    expect(shell.style.getPropertyValue('--app-shell-measured-header-offset')).toBe('var(--app-shell-header-offset)');
  });

  it('uses the measured AppBar height when it is larger than the default shell offset', async () => {
    const restoreRects = mockElementHeightsByTestId({
      'main-layout-app-bar': 88,
      'main-layout-top-banner': 0,
    });

    try {
      render(
        <MainLayout>
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const shell = screen.getByTestId('main-layout-shell');
      expect(shell).toHaveAttribute('data-app-bar-height', '88');
      expect(shell.style.getPropertyValue('--app-shell-measured-header-offset')).toBe('88px');
    } finally {
      restoreRects();
    }
  });

  it('keeps window-controls-overlay header space based on the measured AppBar box', async () => {
    const restoreMatchMedia = installMatchMedia({ windowControlsOverlay: true });
    const restoreRects = mockElementHeightsByTestId({
      'main-layout-app-bar': 96,
      'main-layout-top-banner': 0,
    });

    try {
      render(
        <MainLayout>
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const shell = screen.getByTestId('main-layout-shell');
      expect(shell).toHaveAttribute('data-app-bar-height', '96');
      expect(shell.style.getPropertyValue('--app-shell-measured-header-offset')).toBe('96px');
    } finally {
      restoreRects();
      restoreMatchMedia();
    }
  });

  it('does not reserve AppBar space when the header is hidden', async () => {
    render(
      <MainLayout headerMode="hidden">
        <div>Child content</div>
      </MainLayout>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const shell = screen.getByTestId('main-layout-shell');
    expect(screen.queryByTestId('main-layout-app-bar')).toBeNull();
    expect(screen.queryByTestId('main-layout-top-spacer')).toBeNull();
    expect(shell).toHaveAttribute('data-app-bar-height', '0');
    expect(shell.style.getPropertyValue('--app-shell-measured-header-offset')).toBe('0px');
  });

  it('reserves a safe top inset for regular mobile pages with a hidden header', async () => {
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      render(
        <MainLayout headerMode="hidden">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('main-layout-top-spacer')).toHaveStyle({
        height: 'max(var(--app-shell-top-offset), 10px)',
      });
    } finally {
      restoreMobileMatchMedia();
    }
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

describe('MainLayout mobile bottom navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHasPermission.mockReset();
    mockHasPermission.mockImplementation(() => true);
    mockNavigate.mockReset();
    mockApiGet.mockReset();
    mockGetChatUnreadSummary.mockReset();
    mockGetUnreadCount.mockReset();
    mockLocation.pathname = '/tasks';
    mockLocation.search = '';
    mockPreferences.mobile_bottom_nav_items = ['/dashboard', '/tasks', '/chat', '/mail'];
    mockApiGet.mockImplementation(async (url) => {
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
            tasks_open_total: 4,
            tasks_open: 4,
          },
        };
      }
      return { data: {} };
    });
    mockGetChatUnreadSummary.mockResolvedValue({ messages_unread_total: 0, conversations_unread: 0 });
    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the global app bar on phones even with default headerMode', async () => {
    mockLocation.pathname = '/settings';
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      render(
        <MainLayout>
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByTestId('main-layout-app-bar')).toBeNull();
    } finally {
      restoreMobileMatchMedia();
    }
  });

  it('renders the mobile bottom bar with active tab and task badge', async () => {
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      render(
        <MainLayout mobileBottomNavMode="auto">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await vi.runOnlyPendingTimersAsync();
      });

      expect(screen.getByTestId('main-layout-mobile-bottom-nav')).toBeInTheDocument();
      expect(within(screen.getByTestId('main-layout-mobile-bottom-nav')).getAllByRole('button')).toHaveLength(5);
      expect(screen.getByTestId('main-layout-mobile-bottom-nav-dashboard')).toBeInTheDocument();
      expect(screen.getByTestId('main-layout-mobile-bottom-nav-tasks')).toHaveClass('Mui-selected');
      expect(within(screen.getByTestId('main-layout-mobile-bottom-nav-tasks')).getByText('4')).toBeInTheDocument();
    } finally {
      restoreMobileMatchMedia();
    }
  });

  it('hides the mobile bottom bar when mobileBottomNavMode is hidden', async () => {
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      render(
        <MainLayout mobileBottomNavMode="hidden">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('main-layout-mobile-bottom-nav')).toHaveAttribute('data-mobile-bottom-nav-hidden', 'true');
    } finally {
      restoreMobileMatchMedia();
    }
  });

  it('does not render the mobile bottom bar on desktop', async () => {
    const restoreDesktopMatchMedia = installMatchMedia({ mobile: false });

    try {
      render(
        <MainLayout mobileBottomNavMode="auto">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByTestId('main-layout-mobile-bottom-nav')).toBeNull();
    } finally {
      restoreDesktopMatchMedia();
    }
  });

  it('hides configured tabs without permission and still shows menu', async () => {
    mockHasPermission.mockImplementation((permission) => (
      permission !== 'tasks.read'
      && permission !== 'chat.read'
      && permission !== 'mail.access'
    ));
    mockLocation.pathname = '/menu';
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      render(
        <MainLayout mobileBottomNavMode="auto">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('main-layout-mobile-bottom-nav')).toBeInTheDocument();
      expect(screen.getByTestId('main-layout-mobile-bottom-nav-menu')).toBeInTheDocument();
      expect(screen.queryByTestId('main-layout-mobile-bottom-nav-tasks')).toBeNull();
      expect(screen.queryByTestId('main-layout-mobile-bottom-nav-chat')).toBeNull();
      expect(screen.queryByTestId('main-layout-mobile-bottom-nav-mail')).toBeNull();
    } finally {
      restoreMobileMatchMedia();
    }
  });

  it('marks the active mobile tab from the current route', async () => {
    mockLocation.pathname = '/chat';
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      render(
        <MainLayout mobileBottomNavMode="auto">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('main-layout-mobile-bottom-nav-chat')).toHaveClass('Mui-selected');
    } finally {
      restoreMobileMatchMedia();
    }
  });

  it('uses the personalized four items in system order', async () => {
    mockPreferences.mobile_bottom_nav_items = ['/statistics', '/database', '/tickets', '/address-book'];
    mockLocation.pathname = '/database';
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      render(
        <MainLayout mobileBottomNavMode="auto">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const nav = screen.getByTestId('main-layout-mobile-bottom-nav');
      const buttons = within(nav).getAllByRole('button');
      expect(buttons.map((button) => button.getAttribute('data-testid'))).toEqual([
        'main-layout-mobile-bottom-nav-tickets',
        'main-layout-mobile-bottom-nav-address-book',
        'main-layout-mobile-bottom-nav-database',
        'main-layout-mobile-bottom-nav-statistics',
        'main-layout-mobile-bottom-nav-menu',
      ]);
      expect(screen.getByTestId('main-layout-mobile-bottom-nav-database')).toHaveClass('Mui-selected');
    } finally {
      restoreMobileMatchMedia();
    }
  });

  it('marks menu active for an accessible route outside the pinned items', async () => {
    mockLocation.pathname = '/settings';
    const restoreMobileMatchMedia = installMatchMedia({ mobile: true });

    try {
      render(
        <MainLayout mobileBottomNavMode="auto">
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('main-layout-mobile-bottom-nav-menu')).toHaveClass('Mui-selected');
    } finally {
      restoreMobileMatchMedia();
    }
  });
});

describe('MainLayout desktop account navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    mockHasPermission.mockReset();
    mockHasPermission.mockImplementation(() => true);
    mockNavigate.mockReset();
    mockApiGet.mockReset();
    mockGetChatUnreadSummary.mockReset();
    mockGetUnreadCount.mockReset();
    mockLocation.pathname = '/dashboard';
    mockLocation.search = '';
    mockPreferences.mobile_bottom_nav_items = ['/dashboard', '/tasks', '/chat', '/mail'];
    mockApiGet.mockImplementation(async (url) => {
      if (url === '/database/list') return { data: [{ id: 'default', name: 'Основная БД' }] };
      if (url === '/database/current') return { data: { id: 'default', name: 'Основная БД', locked: false } };
      if (url === '/hub/notifications/unread-counts') return { data: { notifications_unread_total: 0 } };
      return { data: {} };
    });
    mockGetChatUnreadSummary.mockResolvedValue({ messages_unread_total: 0, conversations_unread: 0 });
    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the tools group state', async () => {
    const restoreDesktopMatchMedia = installMatchMedia({ mobile: false });
    try {
      render(
        <MainLayout>
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const toggle = screen.getByTestId('main-layout-sidebar-tools-toggle-desktop');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(window.localStorage.getItem('sidebar_tools_expanded')).toBe('false');
    } finally {
      restoreDesktopMatchMedia();
    }
  });

  it('opens the account menu and navigates to profile', async () => {
    const restoreDesktopMatchMedia = installMatchMedia({ mobile: false });
    try {
      render(
        <MainLayout>
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      fireEvent.click(screen.getByTestId('main-layout-account-button-desktop'));
      expect(screen.getByRole('menuitem', { name: 'Администрирование' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Профиль' }));
      expect(mockNavigate).toHaveBeenCalledWith('/profile');
    } finally {
      restoreDesktopMatchMedia();
    }
  });

  it('restores the compact icon rail from local storage', async () => {
    window.localStorage.setItem('sidebar_collapsed', 'true');
    const restoreDesktopMatchMedia = installMatchMedia({ mobile: false });
    try {
      render(
        <MainLayout>
          <div>Child content</div>
        </MainLayout>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByTestId('main-layout-account-button-mobile')).toBeNull();
      expect(screen.getByRole('button', { name: 'Развернуть боковое меню' })).toBeInTheDocument();
      expect(screen.getByTestId('main-layout-account-button-desktop')).toHaveAttribute('aria-label', 'Открыть меню профиля');
    } finally {
      restoreDesktopMatchMedia();
    }
  });
});
