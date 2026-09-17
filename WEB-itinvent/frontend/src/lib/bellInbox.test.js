import { describe, expect, it, vi } from 'vitest';

vi.mock('./chatNotifications', () => ({
  filterHubBellNotifications: vi.fn((items) => items.filter((item) => !item?.hidden)),
}));

import {
  selectHubBellItems,
  selectMailBellItems,
  shouldKeepMailNotificationAfterRead,
} from './bellInbox';

describe('selectHubBellItems', () => {
  it('keeps only unread rows, applies the domain filter and sorts newest first', () => {
    const response = {
      data: {
        items: [
          { id: 'old', unread: 1, created_at: '2026-01-01T10:00:00' },
          { id: 'read', unread: 0, created_at: '2026-01-03T10:00:00' },
          { id: 'new', unread: 1, created_at: '2026-01-02T10:00:00' },
          { id: 'hidden', unread: 1, hidden: true, created_at: '2026-01-04T10:00:00' },
        ],
      },
    };
    expect(selectHubBellItems(response).map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('tolerates missing data', () => {
    expect(selectHubBellItems(null)).toEqual([]);
    expect(selectHubBellItems({})).toEqual([]);
  });
});

describe('selectMailBellItems', () => {
  it('keeps unread mail newest first', () => {
    const items = selectMailBellItems({
      items: [
        { id: 'a', received_at: '2026-01-01T10:00:00' },
        { id: 'b', is_read: true, received_at: '2026-01-03T10:00:00' },
        { id: 'c', received_at: '2026-01-02T10:00:00' },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(['c', 'a']);
  });
});

describe('shouldKeepMailNotificationAfterRead', () => {
  it('filters by message id in messages mode', () => {
    expect(shouldKeepMailNotificationAfterRead({ id: 'm1' }, { targetId: 'm1', mode: 'messages' })).toBe(false);
    expect(shouldKeepMailNotificationAfterRead({ id: 'm2' }, { targetId: 'm1', mode: 'messages' })).toBe(true);
  });

  it('filters by conversation id in conversations mode', () => {
    expect(shouldKeepMailNotificationAfterRead({ conversation_id: 'c1' }, { targetId: 'c1', mode: 'conversations' })).toBe(false);
    expect(shouldKeepMailNotificationAfterRead({ id: 'm1' }, { targetId: 'm1', mode: 'conversations' })).toBe(true);
  });

  it('keeps everything without a target', () => {
    expect(shouldKeepMailNotificationAfterRead({ id: 'm1' }, { targetId: '' })).toBe(true);
  });
});
