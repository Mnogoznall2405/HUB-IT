import { describe, expect, it } from 'vitest';

import {
  applyReadStateOverridesToConversationDetail,
  applyReadStateOverridesToListData,
  applyReadStateOverridesToMessageDetail,
  buildMailReadMutationPlan,
  clearLocalReadStateOverride,
  getConversationReadUnreadCount,
  getLocalReadStateOverride,
  getReadStateOverrideKey,
  pruneLocalReadStateOverrides,
  setLocalReadStateOverride,
} from './mailReadStateModel';

describe('mailReadStateModel read-state overrides', () => {
  it('normalizes override keys by mode and target id', () => {
    expect(getReadStateOverrideKey({ mode: 'conversations', targetId: '  c-1  ' }))
      .toBe('conversations:c-1');
    expect(getReadStateOverrideKey({ mode: 'other', targetId: 42 }))
      .toBe('messages:42');
    expect(getReadStateOverrideKey({ mode: 'messages', targetId: '   ' }))
      .toBe('');
  });

  it('prunes stale overrides by ttl without mutating the source map', () => {
    const source = new Map([
      ['messages:fresh', { isRead: true, updatedAt: 950 }],
      ['messages:stale', { isRead: false, updatedAt: 800 }],
    ]);

    const pruned = pruneLocalReadStateOverrides({
      overrides: source,
      now: 1000,
      ttlMs: 100,
    });

    expect([...pruned.keys()]).toEqual(['messages:fresh']);
    expect([...source.keys()]).toEqual(['messages:fresh', 'messages:stale']);
  });

  it('sets, reads, clears, and ttl-prunes a local override map', () => {
    const withOverride = setLocalReadStateOverride({
      mode: 'messages',
      targetId: ' msg-1 ',
      isRead: true,
      overrides: new Map([
        ['messages:stale', { isRead: false, updatedAt: 100 }],
      ]),
      now: 500,
      ttlMs: 200,
    });

    expect([...withOverride.keys()]).toEqual(['messages:msg-1']);
    expect(getLocalReadStateOverride({
      mode: 'messages',
      targetId: 'msg-1',
      overrides: withOverride,
    })).toBe(true);

    const cleared = clearLocalReadStateOverride({
      mode: 'messages',
      targetId: 'msg-1',
      overrides: withOverride,
    });
    expect(getLocalReadStateOverride({
      mode: 'messages',
      targetId: 'msg-1',
      overrides: cleared,
    })).toBeNull();
  });

  it('builds read mutation plans with stable unread deltas', () => {
    expect(buildMailReadMutationPlan({
      mode: 'messages',
      targetId: ' msg-1 ',
      nextIsRead: true,
      currentUnreadCount: 1,
    })).toEqual({
      normalizedMode: 'messages',
      normalizedTargetId: 'msg-1',
      normalizedUnreadCount: 1,
      normalizedMessageCount: 1,
      nextIsRead: true,
      unreadDelta: -1,
    });

    expect(buildMailReadMutationPlan({
      mode: 'messages',
      targetId: 'msg-1',
      nextIsRead: false,
      currentUnreadCount: 0,
    }).unreadDelta).toBe(1);

    expect(buildMailReadMutationPlan({
      mode: 'conversations',
      targetId: 'conv-1',
      nextIsRead: false,
      currentUnreadCount: 1,
      currentMessageCount: 4,
    }).unreadDelta).toBe(3);

    expect(buildMailReadMutationPlan({ targetId: '   ' })).toBeNull();
  });

  it('calculates conversation unread count for local optimistic state', () => {
    expect(getConversationReadUnreadCount({ isRead: true, unreadCount: 4, messageCount: 9 })).toBe(0);
    expect(getConversationReadUnreadCount({ isRead: false, unreadCount: 0, messageCount: 3 })).toBe(3);
    expect(getConversationReadUnreadCount({ isRead: false, unreadCount: 2, messageCount: 1 })).toBe(2);
  });

  it('applies a message override to list items', () => {
    const overrides = new Map([
      ['messages:msg-1', { isRead: true, updatedAt: 1000 }],
    ]);

    expect(applyReadStateOverridesToListData({
      listData: {
        items: [
          { id: 'msg-1', is_read: false, subject: 'First' },
          { id: 'msg-2', is_read: false, subject: 'Second' },
        ],
      },
      selectionMode: 'messages',
      overrides,
    }).items).toEqual([
      { id: 'msg-1', is_read: true, subject: 'First' },
      { id: 'msg-2', is_read: false, subject: 'Second' },
    ]);
  });

  it('applies a conversation override to list unread_count', () => {
    const readOverrides = new Map([
      ['conversations:conv-1', { isRead: true, updatedAt: 1000 }],
    ]);
    const unreadOverrides = new Map([
      ['conversations:conv-1', { isRead: false, updatedAt: 1000 }],
    ]);

    expect(applyReadStateOverridesToListData({
      listData: { items: [{ id: 'conv-1', unread_count: 3 }] },
      selectionMode: 'conversations',
      overrides: readOverrides,
    }).items[0].unread_count).toBe(0);

    expect(applyReadStateOverridesToListData({
      listData: { items: [{ id: 'conv-1', unread_count: 0 }] },
      selectionMode: 'conversations',
      overrides: unreadOverrides,
    }).items[0].unread_count).toBe(1);
  });

  it('applies a message detail override', () => {
    const message = { id: 'msg-1', is_read: false, subject: 'Hello' };
    const overrides = new Map([
      ['messages:msg-1', { isRead: true, updatedAt: 1000 }],
    ]);

    expect(applyReadStateOverridesToMessageDetail({ message, overrides }))
      .toEqual({ id: 'msg-1', is_read: true, subject: 'Hello' });
  });

  it('applies a conversation detail override to unread_count and item states', () => {
    const conversation = {
      conversation_id: 'conv-1',
      unread_count: 2,
      items: [
        { id: 'msg-1', is_read: false },
        { id: 'msg-2', is_read: false },
      ],
    };
    const overrides = new Map([
      ['conversations:conv-1', { isRead: true, updatedAt: 1000 }],
    ]);

    expect(applyReadStateOverridesToConversationDetail({ conversation, overrides }))
      .toEqual({
        conversation_id: 'conv-1',
        unread_count: 0,
        items: [
          { id: 'msg-1', is_read: true },
          { id: 'msg-2', is_read: true },
        ],
      });
  });
});
