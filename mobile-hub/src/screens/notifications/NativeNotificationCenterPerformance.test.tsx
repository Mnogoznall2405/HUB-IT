import { act, render, waitFor } from '@testing-library/react-native';
import * as notificationApi from '../../api/notificationApi';
import { NativeNotificationCenterScreen } from './NativeNotificationCenterScreen';

const mockNotificationRowRender = jest.fn();

jest.mock('react-native', () => {
  const React = require('react');
  const actual = jest.requireActual('react-native');
  const ActualPressable = actual.Pressable;
  Object.defineProperty(actual, 'Pressable', {
    configurable: true,
    value: React.forwardRef((props: { testID?: string }, ref: unknown) => {
      if (props.testID?.startsWith('native-notification-hub:')) {
        mockNotificationRowRender(props.testID);
      }
      return React.createElement(ActualPressable, { ...props, ref });
    }),
  });
  return actual;
});

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'notification-performance', role: 'user' },
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/notificationApi', () => ({
  pollHubNotifications: jest.fn(),
  getMailNotificationFeed: jest.fn(),
  markHubNotificationRead: jest.fn(),
  markAllHubNotificationsRead: jest.fn(),
  markAllMailNotificationsRead: jest.fn(),
}));

jest.mock('../../realtime/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
    on: jest.fn(() => jest.fn()),
    onTaskChanged: jest.fn(() => jest.fn()),
    onMailChanged: jest.fn(() => jest.fn()),
  },
}));

const items = Array.from({ length: 30 }, (_, index) => ({
  id: `hub-${index}`,
  entity_type: 'task',
  entity_id: `task-${index}`,
  title: `Notification ${String(index).padStart(2, '0')}`,
  body: 'Stable notification body',
  created_at: new Date(2026, 8, 2, 12, 0, index).toISOString(),
  unread: 1,
}));

const mockedApi = notificationApi as jest.Mocked<typeof notificationApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.pollHubNotifications.mockResolvedValue({
    items,
    unread_counts: { notifications_unread_total: items.length },
    limit: 100,
    unread_only: true,
  });
  mockedApi.getMailNotificationFeed.mockResolvedValue({
    items: [],
    total_unread: 0,
    limit: 50,
  });
});

it('does not rerender mounted notification rows for the refresh spinner', async () => {
  const view = await render(<NativeNotificationCenterScreen />);
  await waitFor(() => expect(view.getByText('Notification 29')).toBeTruthy());
  mockNotificationRowRender.mockClear();

  mockedApi.pollHubNotifications.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-notifications-list').props.onRefresh();
  });

  expect(mockNotificationRowRender).toHaveBeenCalledTimes(0);
});
