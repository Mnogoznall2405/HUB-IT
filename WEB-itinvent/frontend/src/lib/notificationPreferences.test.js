import { describe, expect, it, vi } from 'vitest';

import {
  dispatchNotificationPreferencesChanged,
  isNotificationChannelEnabled,
  normalizeNotificationPreferences,
  NOTIFICATION_PREFERENCES_CHANGED_EVENT,
} from './notificationPreferences';

describe('notificationPreferences', () => {
  it('normalizes the existing server channel model without inventing Desktop settings', () => {
    expect(normalizeNotificationPreferences({
      mail: false,
      tasks: true,
      task_email: false,
      announcements: false,
      chat: true,
      ignored: false,
    })).toEqual({
      mail: false,
      tasks: true,
      task_email: false,
      announcements: false,
      chat: true,
    });
  });

  it.each([
    [{ channel: 'mail' }, 'mail'],
    [{ channel: 'task' }, 'tasks'],
    [{ channel: 'feed' }, 'announcements'],
    [{ channel: 'chat' }, 'chat'],
    [{ channel: 'mention' }, 'chat'],
    [{ entity_type: 'task' }, 'tasks'],
    [{ entity_type: 'announcement' }, 'announcements'],
  ])('maps %j to the existing %s preference', (notification, disabledKey) => {
    const preferences = normalizeNotificationPreferences({ [disabledKey]: false });
    expect(isNotificationChannelEnabled(notification, preferences)).toBe(false);
  });

  it('keeps ticket and scan enabled until the server model exposes those channels', () => {
    const preferences = normalizeNotificationPreferences({
      mail: false,
      tasks: false,
      announcements: false,
      chat: false,
    });
    expect(isNotificationChannelEnabled({ channel: 'ticket' }, preferences)).toBe(true);
    expect(isNotificationChannelEnabled({ channel: 'scan' }, preferences)).toBe(true);
  });

  it('broadcasts only the normalized server preferences', () => {
    const listener = vi.fn();
    window.addEventListener(NOTIFICATION_PREFERENCES_CHANGED_EVENT, listener);

    dispatchNotificationPreferencesChanged({ mail: false, extra: 'secret' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      mail: false,
      tasks: true,
      task_email: true,
      announcements: true,
      chat: true,
    });
    window.removeEventListener(NOTIFICATION_PREFERENCES_CHANGED_EVENT, listener);
  });
});
