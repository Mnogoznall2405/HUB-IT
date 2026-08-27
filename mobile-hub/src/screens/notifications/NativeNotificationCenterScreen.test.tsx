import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as mailApi from '../../api/mailApi';
import * as mailboxApi from '../../api/mailMailboxesApi';
import * as notificationApi from '../../api/notificationApi';
import { writeNativeSnapshot } from '../../cache/nativeSnapshotCache';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { NativeNotificationCenterScreen } from './NativeNotificationCenterScreen';

let mockPermissions: string[];
let mockOfflineMode = false;
const mockPreferences = { theme_mode: 'system' };

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'notification-test', role: 'user', permissions: mockPermissions },
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: mockPreferences }),
}));

jest.mock('../../api/notificationApi', () => ({
  pollHubNotifications: jest.fn(),
  getMailNotificationFeed: jest.fn(),
  markHubNotificationRead: jest.fn(),
  markAllHubNotificationsRead: jest.fn(),
  markAllMailNotificationsRead: jest.fn(),
}));

jest.mock('../../api/mailApi', () => ({
  markMailMessageRead: jest.fn(),
}));

jest.mock('../../api/mailMailboxesApi', () => ({
  listMailboxes: jest.fn(),
}));

jest.mock('../../navigation/moduleRegistry', () => ({
  openPortalPath: jest.fn(),
}));

const hubItem = {
  id: 'hub-1',
  entity_type: 'task',
  entity_id: 'task-7',
  title: 'Новый комментарий',
  body: 'Проверьте результат',
  created_at: new Date().toISOString(),
  unread: 1,
};

const mailItem = {
  id: 'mail-1',
  mailbox_id: 'box-1',
  sender: 'Иван Петров',
  subject: 'Отчёт готов',
  received_at: new Date().toISOString(),
  is_read: false,
};

describe('NativeNotificationCenterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissions = ['dashboard.read', 'tasks.read', 'mail.access'];
    mockOfflineMode = false;
    (notificationApi.pollHubNotifications as jest.Mock).mockResolvedValue({
      items: [hubItem],
      unread_counts: { notifications_unread_total: 1 },
      limit: 100,
      unread_only: true,
    });
    (notificationApi.getMailNotificationFeed as jest.Mock).mockResolvedValue({
      items: [mailItem],
      total_unread: 1,
      limit: 50,
    });
    (notificationApi.markHubNotificationRead as jest.Mock).mockResolvedValue(undefined);
    (notificationApi.markAllHubNotificationsRead as jest.Mock).mockResolvedValue(1);
    (notificationApi.markAllMailNotificationsRead as jest.Mock).mockResolvedValue(1);
    (mailApi.markMailMessageRead as jest.Mock).mockResolvedValue(undefined);
    (mailboxApi.listMailboxes as jest.Mock).mockResolvedValue([
      { id: 'box-1', is_active: true },
      { id: 'box-2', is_active: true },
    ]);
  });

  it('does not call protected APIs without a supported permission', async () => {
    mockPermissions = [];
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
    expect(notificationApi.pollHubNotifications).not.toHaveBeenCalled();
    expect(notificationApi.getMailNotificationFeed).not.toHaveBeenCalled();
  });

  it('loads one chronological native inbox and opens a task natively', async () => {
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByText('Новый комментарий')).toBeTruthy());
    expect(view.getByText('Отчёт готов')).toBeTruthy();
    expect(view.getByText('Непрочитанных: 2')).toBeTruthy();

    fireEvent.press(view.getByTestId('native-notification-hub:hub-1'));
    await waitFor(() => expect(notificationApi.markHubNotificationRead).toHaveBeenCalledWith('hub-1'));
    expect(openPortalPath).toHaveBeenCalledWith('/tasks?task=task-7');
  });

  it('marks a mailbox-scoped message read and opens native Mail', async () => {
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByText('Отчёт готов')).toBeTruthy());

    fireEvent.press(view.getByTestId('native-notification-mail:box-1:mail-1'));
    await waitFor(() => expect(mailApi.markMailMessageRead).toHaveBeenCalledWith('mail-1', 'box-1'));
    expect(openPortalPath).toHaveBeenCalledWith('/mail?folder=inbox&message=mail-1&mailbox_id=box-1');
  });

  it('marks both notification sources read without a full reload', async () => {
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByText('Непрочитанных: 2')).toBeTruthy());
    fireEvent.press(view.getByTestId('native-notifications-mark-all'));
    await waitFor(() => expect(view.getByText('Всё прочитано')).toBeTruthy());
    expect(notificationApi.markAllHubNotificationsRead).toHaveBeenCalledTimes(1);
    expect(mailboxApi.listMailboxes).toHaveBeenCalledWith(false);
    expect(notificationApi.markAllMailNotificationsRead).toHaveBeenCalledWith(['box-1', 'box-2']);
    expect(notificationApi.pollHubNotifications).toHaveBeenCalledTimes(1);
  });

  it('opens an item offline without falsely changing read state', async () => {
    mockOfflineMode = true;
    await writeNativeSnapshot('notifications', 1, {
      hubItems: [hubItem],
      mailItems: [mailItem],
      hubUnread: 1,
      mailUnread: 1,
    });
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByText('Новый комментарий')).toBeTruthy());

    fireEvent.press(view.getByTestId('native-notification-hub:hub-1'));

    expect(openPortalPath).toHaveBeenCalledWith('/tasks?task=task-7');
    expect(notificationApi.markHubNotificationRead).not.toHaveBeenCalled();
    expect(view.getByText('Непрочитанных: 2')).toBeTruthy();
  });

  it('keeps notification settings native and omits the web fallback', async () => {
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByTestId('native-notifications-settings')).toBeTruthy());
    expect(view.queryByTestId('native-notifications-open-web')).toBeNull();
    fireEvent.press(view.getByTestId('native-notifications-settings'));
    expect(router.push).toHaveBeenCalledWith('/(shell)/menu/settings/notifications');
  });

});
