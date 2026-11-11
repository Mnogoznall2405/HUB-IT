import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { hubRealtimeSocket } from '../realtime/hubRealtimeSocket';
import { setNativeBadgeCount } from '../notifications/notificationBadge';
import { getNativeUnreadSnapshot } from '../notifications/nativeUnreadSnapshot';
import { HUB_REALTIME_REFRESH_DEBOUNCE_MS, useNavUnreadCounts } from './useNavUnreadCounts';
import { getNavigationBadgeCount } from './mobileNavItems';

let taskChanged: ((payload: unknown) => void) | null = null;
let localMailChanged: ((payload: unknown) => void) | null = null;
const mockHasPermission = (permission: string) => ['chat.read', 'mail.access'].includes(permission);
const mockUser = { id: 7, role: 'user', permissions: ['chat.read', 'mail.access'] };

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    hasPermission: mockHasPermission,
  }),
}));
const mockChatHandlers = new Map<string, (envelope: unknown) => void>();
jest.mock('../chat/chatSocket', () => ({
  chatSocket: {
    getStatus: jest.fn(() => 'connected'),
    on: jest.fn((event: string, handler: (envelope: unknown) => void) => {
      mockChatHandlers.set(event, handler);
      return jest.fn();
    }),
  },
}));
jest.mock('../realtime/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
    getStatus: jest.fn(() => 'connected'),
    on: jest.fn(() => jest.fn()),
    onTaskChanged: jest.fn((listener) => {
      taskChanged = listener;
      return jest.fn();
    }),
    onMailChanged: jest.fn(() => jest.fn()),
  },
}));
jest.mock('../mail/nativeMailUnreadEvents', () => ({
  applyNativeMailUnreadChange: jest.fn((count) => Math.max(0, count - 1)),
  subscribeNativeMailUnread: jest.fn((listener) => {
    localMailChanged = listener;
    return jest.fn();
  }),
}));
jest.mock('../notifications/notificationBadge', () => ({
  setNativeBadgeCount: jest.fn(async () => 9),
}));
jest.mock('../notifications/nativeUnreadSnapshot', () => ({
  getNativeUnreadSnapshot: jest.fn(),
  nativeUnreadTotal: jest.fn((snapshot) => (
    Number(snapshot.notifications_unread_total || 0)
    + Number(snapshot.announcements_unread || 0)
    + Number(snapshot.chat_messages_unread_total || 0)
    + Number(snapshot.mail_unread || 0)
  )),
}));

function Probe() {
  const counts = useNavUnreadCounts();
  return <Text>{String(counts.tasks_open_total)}</Text>;
}

function ChatBadgeProbe() {
  const counts = useNavUnreadCounts();
  return <Text>{String(getNavigationBadgeCount('/chat', counts))}</Text>;
}

beforeEach(() => {
  taskChanged = null;
  localMailChanged = null;
  mockChatHandlers.clear();
  jest.clearAllMocks();
  jest.mocked(getNativeUnreadSnapshot).mockResolvedValue({
    tasks_open: 2,
    tasks_open_total: 2,
    chat_messages_unread_total: 3,
    mail_unread: 4,
    mail_state: 'ok',
    notifications_unread_total: 1,
    announcements_unread: 1,
    successful_sources: 3,
  });
});

it('shares the initial unread snapshot with the launcher badge', async () => {
  const view = await render(<Probe />);

  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  expect(getNativeUnreadSnapshot).toHaveBeenCalledWith({
    canReadChat: true,
    canReadMail: true,
    force: false,
  });
  expect(setNativeBadgeCount).toHaveBeenCalledWith(9);
  view.unmount();
});

it('feeds the server chat total (chats + AI) into the bottom nav badge', async () => {
  // AUDIT-AI-NOTIF: серверный chat_messages_unread_total уже включает ИИ-диалоги.
  const view = await render(<ChatBadgeProbe />);
  await waitFor(() => expect(view.getByText('3')).toBeTruthy());
  view.unmount();
});

it('coalesces Hub task events into one delayed counter refresh', async () => {
  const view = await render(<Probe />);
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  jest.mocked(getNativeUnreadSnapshot).mockClear();

  await act(async () => {
    taskChanged?.({});
    taskChanged?.({});
  });
  expect(getNativeUnreadSnapshot).not.toHaveBeenCalled();

  await waitFor(() => expect(getNativeUnreadSnapshot).toHaveBeenCalledWith({
    canReadChat: true,
    canReadMail: true,
    force: true,
  }), { timeout: HUB_REALTIME_REFRESH_DEBOUNCE_MS + 2000 });
  expect(getNativeUnreadSnapshot).toHaveBeenCalledTimes(1);
  expect(hubRealtimeSocket.onTaskChanged).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('updates the Android badge immediately after a local mail read change', async () => {
  const view = await render(<Probe />);
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  jest.mocked(setNativeBadgeCount).mockClear();

  await act(async () => localMailChanged?.({ delta: -1 }));

  expect(setNativeBadgeCount).toHaveBeenCalledWith(8);
  view.unmount();
});

it('applies the chat total from a realtime unread summary without refetching three endpoints', async () => {
  const view = await render(<ChatBadgeProbe />);
  await waitFor(() => expect(view.getByText('3')).toBeTruthy());
  jest.mocked(getNativeUnreadSnapshot).mockClear();

  await act(async () => mockChatHandlers.get('chat.unread.summary')?.({ payload: { messages_unread_total: 9 } }));

  expect(view.getByText('9')).toBeTruthy();
  expect(getNativeUnreadSnapshot).not.toHaveBeenCalled();
  // Conversation/message events are always followed by the summary: no refetch of their own.
  expect(mockChatHandlers.has('chat.conversation.updated')).toBe(false);
  expect(mockChatHandlers.has('chat.message.created')).toBe(false);
  view.unmount();
});

it('falls back to a refresh when an unread summary carries no usable total', async () => {
  const view = await render(<ChatBadgeProbe />);
  await waitFor(() => expect(view.getByText('3')).toBeTruthy());
  jest.mocked(getNativeUnreadSnapshot).mockClear();

  await act(async () => mockChatHandlers.get('chat.unread.summary')?.({ payload: {} }));

  await waitFor(() => expect(getNativeUnreadSnapshot).toHaveBeenCalledTimes(1), { timeout: HUB_REALTIME_REFRESH_DEBOUNCE_MS + 2000 });
  view.unmount();
});
