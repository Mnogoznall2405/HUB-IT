import { beforeEach, describe, expect, it, vi } from 'vitest';

const desktopBridgeMocks = vi.hoisted(() => ({
  available: false,
  show: vi.fn(() => false),
}));

vi.mock('./desktopBridge', () => ({
  isDesktopNotificationAvailable: () => desktopBridgeMocks.available,
  showDesktopNotification: desktopBridgeMocks.show,
}));

import { createSystemNotificationEnvelope } from './systemNotificationEnvelope';
import {
  hasDeliveredSystemNotification,
  routeSystemNotification,
  SYSTEM_NOTIFICATION_DELIVERED_KEY,
} from './systemNotificationRouter';

function createEnvelope(overrides = {}) {
  return createSystemNotificationEnvelope({
    id: 'task:task-1',
    channel: 'task',
    title: 'Новая задача',
    body: 'Проверьте комментарий',
    route: '/tasks?task=task-1&task_tab=comments',
    created_at: '2026-08-11T12:00:00Z',
    urgency: 'normal',
    ...overrides,
  });
}

describe('systemNotificationRouter', () => {
  let instances;
  let permission;

  beforeEach(() => {
    window.localStorage.clear();
    instances = [];
    permission = 'granted';
    desktopBridgeMocks.available = false;
    desktopBridgeMocks.show.mockReset();
    desktopBridgeMocks.show.mockReturnValue(false);
    window.focus = vi.fn();

    class MockNotification {
      constructor(title, options) {
        this.title = title;
        this.options = options;
        this.onclick = null;
        this.close = vi.fn();
        instances.push(this);
      }
    }

    Object.defineProperty(MockNotification, 'permission', {
      configurable: true,
      get: () => permission,
    });
    window.Notification = MockNotification;
  });

  it.each([true, false])('records native delivery only after host confirmation: %s', (accepted) => {
    desktopBridgeMocks.available = true;
    let finish;
    desktopBridgeMocks.show.mockImplementation(({ onResult }) => { finish = onResult; return true; });
    const envelope = createEnvelope({ id: `task:confirmation-${accepted}` });
    routeSystemNotification(envelope);
    expect(hasDeliveredSystemNotification(envelope.id)).toBe(false);
    expect(routeSystemNotification(envelope)).toBeNull();
    finish(accepted);
    expect(hasDeliveredSystemNotification(envelope.id)).toBe(accepted);
    if (!accepted) {
      desktopBridgeMocks.show.mockReturnValue(false);
      permission = 'denied';
      routeSystemNotification(envelope);
      expect(desktopBridgeMocks.show).toHaveBeenCalledTimes(2);
    }
  });

  it('sends only the bridge v1 minimum and deduplicates the same id', () => {
    desktopBridgeMocks.available = true;
    desktopBridgeMocks.show.mockImplementation(({ onResult }) => { onResult(true); return true; });
    const envelope = createEnvelope();

    expect(routeSystemNotification(envelope)).toEqual({
      delivery: 'desktop',
      id: 'task:task-1',
    });
    expect(routeSystemNotification(envelope)).toBeNull();
    expect(desktopBridgeMocks.show).toHaveBeenCalledTimes(1);
    expect(desktopBridgeMocks.show).toHaveBeenCalledWith({
      id: 'task:task-1',
      title: 'Новая задача',
      body: 'Проверьте комментарий',
      route: '/tasks?task=task-1&task_tab=comments',
      onResult: expect.any(Function),
    });
    expect(hasDeliveredSystemNotification('task:task-1')).toBe(true);
  });

  it('works in a browser without a Desktop host and navigates on click', () => {
    const onNavigate = vi.fn();
    const source = { source: 'task polling' };

    const result = routeSystemNotification(createEnvelope(), { onNavigate, source });

    expect(result).toEqual({
      delivery: 'browser',
      id: 'task:task-1',
      notification: instances[0],
    });
    expect(instances).toHaveLength(1);
    expect(instances[0].options).toMatchObject({
      body: 'Проверьте комментарий',
      tag: 'task:task-1',
      renotify: false,
    });
    instances[0].onclick?.();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith('/tasks?task=task-1&task_tab=comments', source);
  });

  it('does not mark delivery when native and browser delivery both fail', () => {
    desktopBridgeMocks.available = true;
    desktopBridgeMocks.show.mockReturnValue(false);
    permission = 'denied';

    expect(routeSystemNotification(createEnvelope())).toBeNull();
    expect(hasDeliveredSystemNotification('task:task-1')).toBe(false);
    expect(window.localStorage.getItem(SYSTEM_NOTIFICATION_DELIVERED_KEY)).toBeNull();
  });

  it('uses one shared bounded dedupe store for every channel', () => {
    for (let index = 0; index < 325; index += 1) {
      const id = `mail:message-${index}`;
      routeSystemNotification(createEnvelope({
        id,
        channel: 'mail',
        route: `/mail?message=${index}`,
      }));
    }

    const stored = JSON.parse(window.localStorage.getItem(SYSTEM_NOTIFICATION_DELIVERED_KEY));
    expect(stored).toEqual({ version: 1, ids: expect.any(Array) });
    expect(stored.ids).toHaveLength(300);
    expect(stored.ids[0]).toBe('mail:message-25');
    expect(stored.ids.at(-1)).toBe('mail:message-324');
  });

  it.each([
    ['chat', '/chat?conversation=conv-1'],
    ['mention', '/chat?conversation=conv-1&message=msg-1'],
    ['task', '/tasks?task=task-1'],
    ['feed', '/feed?post=post-1'],
    ['mail', '/mail?message=mail-1'],
    ['ticket', '/tickets?ticket=ticket-1'],
    ['scan', '/scan-center?incident=scan-1'],
  ])('deduplicates the %s channel by the envelope id', (channel, route) => {
    const id = `event:shared-${channel}`;
    const envelope = createEnvelope({ id, channel, route });

    expect(routeSystemNotification(envelope)?.delivery).toBe('browser');
    expect(routeSystemNotification(envelope)).toBeNull();
    expect(instances.filter((item) => item.options.tag === id)).toHaveLength(1);
  });

  it('deduplicates one canonical event even if two sources classify its channel differently', () => {
    const chatEnvelope = createEnvelope({
      id: 'chat:msg:msg-7',
      channel: 'chat',
      route: '/chat?conversation=conv-1&message=msg-7',
    });
    const mentionEnvelope = createEnvelope({
      id: 'chat:msg:msg-7',
      channel: 'mention',
      route: '/chat?conversation=conv-1&message=msg-7',
    });

    expect(routeSystemNotification(chatEnvelope)?.delivery).toBe('browser');
    expect(routeSystemNotification(mentionEnvelope)).toBeNull();
    expect(instances).toHaveLength(1);
  });

  it('rejects invalid input without touching native or browser APIs', () => {
    expect(routeSystemNotification({
      id: 'task:task-1',
      channel: 'task',
      title: 'Title',
      body: 'Body',
      route: 'https://evil.example',
      created_at: '2026-08-11T12:00:00Z',
      urgency: 'normal',
    })).toBeNull();
    expect(desktopBridgeMocks.show).not.toHaveBeenCalled();
    expect(instances).toHaveLength(0);
  });
});
