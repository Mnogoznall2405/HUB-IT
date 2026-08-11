import { describe, expect, it } from 'vitest';
import {
  filterHubBellNotifications,
  isHubBellChatNotification,
  isLegacyOrdinaryChatHubNotification,
  resolveOrdinaryChatHubReadVisible,
} from './chatNotifications';

describe('chat hub bell event filters', () => {
  it('hides ordinary legacy chat hub rows', () => {
    expect(isLegacyOrdinaryChatHubNotification({
      entity_type: 'chat',
      event_type: 'chat.message_received',
    })).toBe(true);
    expect(isLegacyOrdinaryChatHubNotification({
      entity_type: 'chat',
      event_type: 'chat.file_shared',
    })).toBe(true);
    expect(isLegacyOrdinaryChatHubNotification({
      entity_type: 'chat',
      event_type: 'chat.mention',
    })).toBe(false);
    expect(isHubBellChatNotification({
      entity_type: 'chat',
      event_type: 'chat.mention',
    })).toBe(true);
  });

  it('filters ordinary rows only when read_visible is false', () => {
    const items = [
      { id: '1', entity_type: 'chat', event_type: 'chat.message_received' },
      { id: '2', entity_type: 'chat', event_type: 'chat.mention' },
      { id: '3', entity_type: 'task', event_type: 'task.assigned' },
    ];
    expect(filterHubBellNotifications(items, { ordinaryReadVisible: true }).map((item) => item.id))
      .toEqual(['1', '2', '3']);
    expect(filterHubBellNotifications(items, { ordinaryReadVisible: false }).map((item) => item.id))
      .toEqual(['2', '3']);
  });

  it('resolves ordinary_read_visible from API payload', () => {
    expect(resolveOrdinaryChatHubReadVisible(undefined)).toBe(true);
    expect(resolveOrdinaryChatHubReadVisible({ ordinary_read_visible: false })).toBe(false);
    expect(resolveOrdinaryChatHubReadVisible({ ordinary_read_visible: true })).toBe(true);
  });
});
