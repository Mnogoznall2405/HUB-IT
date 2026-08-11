import { beforeEach, describe, expect, it, vi } from 'vitest';

const desktopBridgeMocks = vi.hoisted(() => ({
  available: false,
  show: vi.fn(() => false),
}));

vi.mock('./desktopBridge', () => ({
  isDesktopNotificationAvailable: () => desktopBridgeMocks.available,
  showDesktopNotification: desktopBridgeMocks.show,
}));

vi.mock('./chatFeature', () => ({
  TASK_DISCUSSION_CHAT_ENABLED: false,
}));

import {
  createHubSystemNotification,
  createMailSystemNotification,
  getBrowserNotificationPermission,
  getWindowsNotificationState,
  getHubNotificationActionLabel,
  getHubNotificationNavigateTo,
  getMailSystemNotificationId,
  hasShownHubSystemNotification,
  hasShownMailSystemNotification,
  isNotificationPermissionBannerDismissed,
  isWindowsNotificationsEnabled,
  requestBrowserNotificationPermission,
  setNotificationPermissionBannerDismissed,
  setWindowsNotificationsEnabled,
  WINDOWS_NOTIFICATIONS_PERMISSION_BANNER_DISMISSED_KEY,
} from './windowsNotifications';

describe('windowsNotifications helper', () => {
  let notificationPermission = 'default';
  let notificationInstances = [];

  beforeEach(() => {
    window.localStorage.clear();
    notificationPermission = 'default';
    notificationInstances = [];
    desktopBridgeMocks.available = false;
    desktopBridgeMocks.show.mockReset();
    desktopBridgeMocks.show.mockReturnValue(false);
    window.focus = vi.fn();

    class MockNotification {
      constructor(title, options) {
        this.title = title;
        this.options = options;
        this.close = vi.fn();
        this.onclick = null;
        notificationInstances.push(this);
      }
    }

    Object.defineProperty(MockNotification, 'permission', {
      configurable: true,
      get: () => notificationPermission,
    });

    MockNotification.requestPermission = vi.fn(async () => {
      notificationPermission = 'granted';
      return 'granted';
    });

    window.Notification = MockNotification;
  });

  it('maps hub notifications to deep links', () => {
    expect(getHubNotificationNavigateTo({ entity_type: 'task', entity_id: 'task-1' })).toBe('/tasks?task=task-1&task_tab=comments');
    expect(getHubNotificationNavigateTo({ entity_type: 'announcement', entity_id: 'ann-9' })).toBe('/feed?post=ann-9');
    expect(getHubNotificationNavigateTo({ entity_type: 'chat', entity_id: 'conv-3' })).toBe('/chat?conversation=conv-3');
    expect(getHubNotificationNavigateTo({
      entity_type: 'chat',
      entity_id: 'conv-3',
      message_id: 'msg-9',
    })).toBe('/chat?conversation=conv-3&message=msg-9');
    expect(getHubNotificationNavigateTo({ entity_type: 'other', entity_id: 'x' })).toBe('/dashboard');
    expect(getHubNotificationActionLabel({ entity_type: 'task' })).toBe('Открыть задачу');
    expect(getHubNotificationActionLabel({ entity_type: 'announcement' })).toBe('Открыть публикацию');
    expect(getHubNotificationActionLabel({ entity_type: 'chat' })).toBe('Открыть чат');
    expect(getHubNotificationActionLabel({ entity_type: 'other' })).toBe('Открыть центр');
  });

  it('stores the local enabled toggle and updates permission state after explicit request', async () => {
    expect(isWindowsNotificationsEnabled()).toBe(false);
    expect(getBrowserNotificationPermission()).toBe('default');

    setWindowsNotificationsEnabled(true);
    expect(isWindowsNotificationsEnabled()).toBe(true);

    const nextPermission = await requestBrowserNotificationPermission();
    expect(nextPermission).toBe('granted');
    expect(getBrowserNotificationPermission()).toBe('granted');
  });

  it('persists notification permission banner dismissal', () => {
    expect(isNotificationPermissionBannerDismissed()).toBe(false);
    setNotificationPermissionBannerDismissed(true);
    expect(isNotificationPermissionBannerDismissed()).toBe(true);
    expect(window.localStorage.getItem(WINDOWS_NOTIFICATIONS_PERMISSION_BANNER_DISMISSED_KEY)).toBe('1');
  });

  it('creates a browser notification once per hub id and navigates on click', () => {
    notificationPermission = 'granted';
    const onNavigate = vi.fn();
    const payload = {
      id: 'hub-notification-1',
      title: 'Новая задача',
      body: 'Добавление данных',
      entity_type: 'task',
      entity_id: 'task-77',
    };

    const created = createHubSystemNotification(payload, { onNavigate });
    expect(created).toBeTruthy();
    expect(notificationInstances).toHaveLength(1);
    expect(hasShownHubSystemNotification('hub-notification-1')).toBe(true);

    const duplicated = createHubSystemNotification(payload, { onNavigate });
    expect(duplicated).toBeNull();
    expect(notificationInstances).toHaveLength(1);

    notificationInstances[0].onclick?.();
    expect(window.focus).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith('/tasks?task=task-77&task_tab=comments', payload);
    expect(notificationInstances[0].close).toHaveBeenCalled();
  });

  it('routes hub and mail notifications through the desktop bridge when browser permission is blocked', () => {
    notificationPermission = 'denied';
    desktopBridgeMocks.available = true;
    desktopBridgeMocks.show.mockReturnValue(true);

    expect(getWindowsNotificationState()).toMatchObject({
      supported: true,
      permission: 'granted',
    });

    const hubCreated = createHubSystemNotification({
      id: 'hub-notification-native',
      title: 'Новая задача',
      body: 'Добавление данных',
      entity_type: 'task',
      entity_id: 'task-77',
    });
    const mailCreated = createMailSystemNotification({
      id: 'encoded-message-native',
      internet_message_id: '<native-message@example.com>',
      mailbox_id: 'mailbox-1',
      folder: 'inbox',
      subject: 'Mail subject',
      sender: 'sender@example.com',
    });

    expect(hubCreated).toMatchObject({ native: true });
    expect(mailCreated).toMatchObject({ native: true });
    expect(notificationInstances).toHaveLength(0);
    expect(desktopBridgeMocks.show).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'hub:hub-notification-native',
      route: '/tasks?task=task-77&task_tab=comments',
    }));
    expect(desktopBridgeMocks.show).toHaveBeenNthCalledWith(2, expect.objectContaining({
      route: '/mail?folder=inbox&message=encoded-message-native&mailbox_id=mailbox-1',
    }));
  });

  it('creates a browser mail notification once per stable message id and navigates on click', () => {
    notificationPermission = 'granted';
    const onNavigate = vi.fn();
    const payload = {
      id: 'encoded-message-1',
      internet_message_id: '<stable-message@example.com>',
      mailbox_id: 'mailbox-1',
      folder: 'inbox',
      subject: 'Mail subject',
      sender: 'sender@example.com',
    };
    const notificationId = getMailSystemNotificationId(payload);

    const created = createMailSystemNotification(payload, { onNavigate });
    expect(created).toBeTruthy();
    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].options.tag).toBe(`mail:${notificationId}`);
    expect(hasShownMailSystemNotification(notificationId)).toBe(true);

    const duplicated = createMailSystemNotification({ ...payload, id: 'encoded-message-2' }, { onNavigate });
    expect(duplicated).toBeNull();
    expect(notificationInstances).toHaveLength(1);

    notificationInstances[0].onclick?.();
    expect(window.focus).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith('/mail?folder=inbox&message=encoded-message-1&mailbox_id=mailbox-1', payload);
    expect(notificationInstances[0].close).toHaveBeenCalled();
  });
});
