import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { hubRealtimeSocket } from '../realtime/hubRealtimeSocket';
import { setNativeBadgeCount } from '../notifications/notificationBadge';
import { getNativeUnreadSnapshot } from '../notifications/nativeUnreadSnapshot';
import { useNavUnreadCounts } from './useNavUnreadCounts';

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
jest.mock('../chat/chatSocket', () => ({
  chatSocket: { on: jest.fn(() => jest.fn()) },
}));
jest.mock('../realtime/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
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

beforeEach(() => {
  taskChanged = null;
  localMailChanged = null;
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

it('refreshes navigation counters immediately after a Hub task event', async () => {
  const view = await render(<Probe />);
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  jest.mocked(getNativeUnreadSnapshot).mockClear();

  await act(async () => taskChanged?.({}));

  await waitFor(() => expect(getNativeUnreadSnapshot).toHaveBeenCalledWith({
    canReadChat: true,
    canReadMail: true,
    force: true,
  }));
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
