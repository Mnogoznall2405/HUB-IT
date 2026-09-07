import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import * as mailApi from '../../api/mailApi';
import * as mailboxApi from '../../api/mailMailboxesApi';
import * as notificationApi from '../../api/notificationApi';
import { writeNativeSnapshot } from '../../cache/nativeSnapshotCache';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { NativeNotificationCenterScreen } from './NativeNotificationCenterScreen';

let mockPermissions: string[];
let mockOfflineMode = false;
let mockUserId = 1;
const mockPreferences = { theme_mode: 'system' };

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mockUserId, username: 'notification-test', role: 'user', permissions: mockPermissions },
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
    mockUserId = 1;
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

  it('filters sources without changing unread state and keeps mark-all global', async () => {
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByText('Непрочитанных: 2')).toBeTruthy());
    await fireEvent.press(view.getByTestId('native-notifications-filter-mail'));
    expect(view.getByText('Отчёт готов')).toBeTruthy();
    expect(view.queryByText('Новый комментарий')).toBeNull();
    await fireEvent.press(view.getByTestId('native-notifications-filter-chat'));
    expect(view.getByText('В этом разделе уведомлений нет')).toBeTruthy();
    expect(view.queryByText('Всё прочитано')).toBeNull();
    expect(notificationApi.markHubNotificationRead).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('native-notifications-mark-all'));
    await waitFor(() => expect(notificationApi.markAllHubNotificationsRead).toHaveBeenCalledTimes(1));
    expect(notificationApi.markAllMailNotificationsRead).toHaveBeenCalledWith(['box-1', 'box-2']);
    await fireEvent.press(view.getByTestId('native-notifications-filter-all'));
    expect(view.getByText('Всё прочитано')).toBeTruthy();
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

  it('does not claim everything is read when both sources fail and offers retry', async () => {
    (notificationApi.pollHubNotifications as jest.Mock).mockRejectedValueOnce(new Error('Network unavailable'));
    (notificationApi.getMailNotificationFeed as jest.Mock).mockRejectedValueOnce(new Error('Network unavailable'));
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByText('Не удалось обновить уведомления')).toBeTruthy());
    expect(view.queryByText('Всё прочитано')).toBeNull();
    await fireEvent.press(view.getByTestId('native-notifications-retry'));
    await waitFor(() => expect(view.getByText('Новый комментарий')).toBeTruthy());
  });

  it('keeps the available offline snapshot on pull to refresh', async () => {
    mockOfflineMode = true;
    await writeNativeSnapshot('notifications', 1, {
      hubItems: [hubItem], mailItems: [], hubUnread: 1, mailUnread: 0,
    });
    const view = await render(<NativeNotificationCenterScreen />);
    await waitFor(() => expect(view.getByText('Новый комментарий')).toBeTruthy());
    await fireEvent(view.getByTestId('native-notifications-list'), 'refresh');
    expect(view.queryByText('Нет подключения и сохранённых уведомлений.')).toBeNull();
    expect(view.getByText('Новый комментарий')).toBeTruthy();
    expect(notificationApi.pollHubNotifications).not.toHaveBeenCalled();
  });

  it('ignores a previous user response after switching accounts', async () => {
    let finish!: (value: unknown) => void;
    (notificationApi.pollHubNotifications as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = await render(<NativeNotificationCenterScreen />);
    mockUserId = 2;
    (notificationApi.pollHubNotifications as jest.Mock).mockResolvedValue({ items: [], unread_counts: { notifications_unread_total: 0 } });
    (notificationApi.getMailNotificationFeed as jest.Mock).mockResolvedValue({ items: [], total_unread: 0 });
    await view.rerender(<NativeNotificationCenterScreen />);
    await act(async () => { finish({ items: [hubItem], unread_counts: { notifications_unread_total: 1 } }); });
    expect(view.queryByText('Новый комментарий')).toBeNull();
    expect(view.queryByText('Отчёт готов')).toBeNull();
  });

  it('does not replace a refreshed list with an older pending response', async () => {
    const view = await render(<NativeNotificationCenterScreen />);
    let finish!: (value: unknown) => void;
    (notificationApi.pollHubNotifications as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await fireEvent(view.getByTestId('native-notifications-list'), 'refresh');
    (notificationApi.pollHubNotifications as jest.Mock).mockResolvedValue({ items: [], unread_counts: { notifications_unread_total: 0 } });
    await fireEvent(view.getByTestId('native-notifications-list'), 'refresh');
    await act(async () => { finish({ items: [hubItem], unread_counts: { notifications_unread_total: 1 } }); });
    expect(view.queryByText('Новый комментарий')).toBeNull();
  });

  it('hides cached mail notifications after mail permission is revoked', async () => {
    mockOfflineMode = true;
    await writeNativeSnapshot('notifications', 1, {
      hubItems: [hubItem], mailItems: [mailItem], hubUnread: 1, mailUnread: 1,
    });
    const view = await render(<NativeNotificationCenterScreen />);
    expect(view.getByText('Отчёт готов')).toBeTruthy();
    mockPermissions = ['tasks.read'];
    await view.rerender(<NativeNotificationCenterScreen />);
    expect(view.queryByText('Отчёт готов')).toBeNull();
    expect(view.getByText('Непрочитанных: 1')).toBeTruthy();
  });

  it('does not mark mail read for a new user after a delayed mailbox lookup', async () => {
    let finish!: (value: unknown) => void;
    (mailboxApi.listMailboxes as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = await render(<NativeNotificationCenterScreen />);
    await fireEvent.press(view.getByTestId('native-notifications-mark-all'));
    mockUserId = 2;
    await view.rerender(<NativeNotificationCenterScreen />);
    await act(async () => { finish([{ id: 'box-1', is_active: true }]); });
    expect(notificationApi.markAllMailNotificationsRead).not.toHaveBeenCalled();
  });

  it.each(['hub', 'mail', 'all'])('serializes rapid %s read actions before React renders', async (kind) => {
    let finish!: (value?: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const api = kind === 'hub' ? notificationApi.markHubNotificationRead : kind === 'mail' ? mailApi.markMailMessageRead : notificationApi.markAllHubNotificationsRead;
    (api as jest.Mock).mockReturnValueOnce(pending);
    const view = await render(<NativeNotificationCenterScreen />);
    const id = kind === 'all' ? 'native-notifications-mark-all' : kind === 'hub' ? 'native-notification-hub:hub-1' : 'native-notification-mail:box-1:mail-1';
    const target = view.getByTestId(id);
    const allTarget = view.getByTestId('native-notifications-mark-all');
    await act(async () => { await Promise.all([fireEvent.press(target), fireEvent.press(target), ...(kind !== 'all' ? [fireEvent.press(allTarget)] : [])]); });
    expect(api).toHaveBeenCalledTimes(1);
    if (kind !== 'all') expect(notificationApi.markAllHubNotificationsRead).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await view.unmount();
  });

  it('defers refresh during marking and reconciles only after its result', async () => {
    let fail!: (error: Error) => void;
    (notificationApi.markHubNotificationRead as jest.Mock).mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const view = await render(<NativeNotificationCenterScreen />);
    await fireEvent.press(view.getByTestId('native-notification-hub:hub-1'));
    await fireEvent(view.getByTestId('native-notifications-list'), 'refresh');
    expect(notificationApi.pollHubNotifications).toHaveBeenCalledTimes(1);
    expect(view.queryByText('Новый комментарий')).toBeNull();
    await act(async () => { fail(new Error('Synthetic mark failure')); });
    await waitFor(() => expect(notificationApi.pollHubNotifications).toHaveBeenCalledTimes(2));
    expect(view.getByText('Непрочитанных: 2')).toBeTruthy();
  });

  it('invalidates a refresh started before the read action', async () => {
    const view = await render(<NativeNotificationCenterScreen />);
    let finishLoad!: (value: unknown) => void;
    let finishMark!: (value?: unknown) => void;
    (notificationApi.pollHubNotifications as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finishLoad = resolve; }));
    await fireEvent(view.getByTestId('native-notifications-list'), 'refresh');
    (notificationApi.markHubNotificationRead as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finishMark = resolve; }));
    await fireEvent.press(view.getByTestId('native-notification-hub:hub-1'));
    await act(async () => { finishLoad({ items: [hubItem], unread_counts: { notifications_unread_total: 1 } }); });
    expect(view.queryByText('Новый комментарий')).toBeNull();
    (notificationApi.pollHubNotifications as jest.Mock).mockResolvedValue({ items: [], unread_counts: { notifications_unread_total: 0 } });
    await act(async () => { finishMark(); });
    await waitFor(() => expect(notificationApi.pollHubNotifications).toHaveBeenCalledTimes(3));
    expect(view.getByText('Непрочитанных: 1')).toBeTruthy();
  });

  it.each(['hub', 'mail', 'all'])('persists acknowledged %s read state for offline reopening', async (kind) => {
    const view = await render(<NativeNotificationCenterScreen />);
    const id = kind === 'all' ? 'native-notifications-mark-all' : kind === 'hub' ? 'native-notification-hub:hub-1' : 'native-notification-mail:box-1:mail-1';
    await fireEvent.press(view.getByTestId(id));
    await waitFor(() => expect(view.getByText(kind === 'all' ? 'Всё прочитано' : 'Непрочитанных: 1')).toBeTruthy());
    await view.unmount();
    mockOfflineMode = true;
    const reopened = await render(<NativeNotificationCenterScreen />);
    if (kind !== 'mail') expect(reopened.queryByText('Новый комментарий')).toBeNull();
    if (kind !== 'hub') expect(reopened.queryByText('Отчёт готов')).toBeNull();
    expect(reopened.getByText(kind === 'all' ? 'Всё прочитано' : 'Непрочитанных: 1')).toBeTruthy();
    await reopened.unmount();
  });

  it('persists only successful sources when mark-all partially fails', async () => {
    (notificationApi.markAllMailNotificationsRead as jest.Mock).mockRejectedValueOnce(new Error('Synthetic mail refusal'));
    const view = await render(<NativeNotificationCenterScreen />);
    await fireEvent.press(view.getByTestId('native-notifications-mark-all'));
    await waitFor(() => expect(view.getByText('Непрочитанных: 1')).toBeTruthy());
    await view.unmount();
    mockOfflineMode = true;
    const reopened = await render(<NativeNotificationCenterScreen />);
    expect(reopened.queryByText('Новый комментарий')).toBeNull();
    expect(reopened.getByText('Отчёт готов')).toBeTruthy();
    expect(reopened.getByText('Непрочитанных: 1')).toBeTruthy();
    await reopened.unmount();
  });

  it('explains a notification without a destination instead of silently navigating home', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    (notificationApi.pollHubNotifications as jest.Mock).mockResolvedValue({ items: [{ ...hubItem, entity_id: '' }], unread_counts: { notifications_unread_total: 1 } });
    const view = await render(<NativeNotificationCenterScreen />);
    await fireEvent.press(view.getByTestId('native-notification-hub:hub-1'));
    expect(openPortalPath).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Новый комментарий', expect.stringContaining('Связанную карточку открыть нельзя'), [{ text: 'Понятно' }]);
    expect(notificationApi.markHubNotificationRead).toHaveBeenCalledTimes(1);
    alert.mockRestore();
    await view.unmount();
  });

});
