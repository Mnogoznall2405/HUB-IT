import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHubSystemNotification,
  getBrowserNotificationPermission,
  getHubNotificationActionLabel,
  getHubNotificationNavigateTo,
  hasShownHubSystemNotification,
  isWindowsNotificationsEnabled,
  requestBrowserNotificationPermission,
  setWindowsNotificationsEnabled,
} from './windowsNotifications';

describe('windowsNotifications helper', () => {
  let notificationPermission = 'default';
  let notificationInstances = [];

  beforeEach(() => {
    window.localStorage.clear();
    notificationPermission = 'default';
    notificationInstances = [];
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
    expect(getHubNotificationNavigateTo({ entity_type: 'announcement', entity_id: 'ann-9' })).toBe('/dashboard?announcement=ann-9');
    expect(getHubNotificationNavigateTo({ entity_type: 'chat', entity_id: 'conv-3' })).toBe('/chat?conversation=conv-3');
    expect(getHubNotificationNavigateTo({ entity_type: 'other', entity_id: 'x' })).toBe('/dashboard');
    expect(getHubNotificationActionLabel({ entity_type: 'task' })).toBe('Открыть задачу');
    expect(getHubNotificationActionLabel({ entity_type: 'announcement' })).toBe('Открыть заметку');
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
});
