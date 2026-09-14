import { describe, expect, it } from 'vitest';

import {
  applyMailUnreadDeltaToCounts,
  buildNextUnreadCounts,
  parseHubUnreadCounts,
  resolveChatUnreadDeltaToast,
  resolveMailUnreadResult,
  shouldNotifyMailArrival,
} from './unreadCounts';

describe('parseHubUnreadCounts', () => {
  it('maps hub payload fields with open/total fallbacks', () => {
    const parsed = parseHubUnreadCounts({
      notifications_unread_total: '5',
      announcements_unread: 2,
      tasks_open_total: 7,
      tasks_new: 1,
      tasks_overdue: 3,
    });
    expect(parsed.notificationsUnreadTotal).toBe(5);
    expect(parsed.tasksOpenTotal).toBe(7);
    expect(parsed.tasksOpen).toBe(7);
    expect(parsed.tasksOverdue).toBe(3);
    expect(parsed.hubChatOrdinary).toBeNull();
  });

  it('prefers tasks_open_total but falls back to tasks_open', () => {
    expect(parseHubUnreadCounts({ tasks_open: 4 }).tasksOpenTotal).toBe(4);
    expect(parseHubUnreadCounts({ tasks_open_total: 9, tasks_open: 4 }).tasksOpen).toBe(4);
  });
});

describe('resolveMailUnreadResult', () => {
  it('keeps current counts when a mutation raced the fetch', () => {
    const result = resolveMailUnreadResult({
      data: { unread_count: 99, state: 'ok' },
      mutationRaced: true,
      currentCounts: { mail_unread: 3, mail_state: 'ok', mail_as_of: 't1' },
    });
    expect(result).toEqual({ mailUnread: 3, mailState: 'ok', mailAsOf: 't1' });
  });

  it('keeps previous unread on unknown/error state without as_of', () => {
    const result = resolveMailUnreadResult({
      data: { state: 'error' },
      previousCounts: { mail_unread: 8 },
    });
    expect(result.mailUnread).toBe(8);
    expect(result.mailState).toBe('error');
  });

  it('uses the API value on a healthy response', () => {
    const result = resolveMailUnreadResult({
      data: { unread_count: '12', state: 'ok', as_of: 'now' },
      previousCounts: { mail_unread: 8 },
    });
    expect(result).toEqual({ mailUnread: 12, mailState: 'ok', mailAsOf: 'now' });
  });
});

describe('buildNextUnreadCounts', () => {
  it('sums hub + mail unread into the total badge', () => {
    const next = buildNextUnreadCounts({
      hub: { notificationsUnreadTotal: 4, tasksOpenTotal: 2, tasksOpen: 2 },
      mail: { unread: 3, state: 'ok', asOf: 't' },
      chat: { messagesUnreadTotal: 9, conversationsUnread: 2 },
      chatWsEnabled: false,
    });
    expect(next.notifications_unread_total).toBe(7);
    expect(next.chat_messages_unread_total).toBe(9);
    expect(next.mail_state).toBe('ok');
  });

  it('preserves previous chat counts when WS is live', () => {
    const next = buildNextUnreadCounts({
      hub: {}, mail: { unread: 0 },
      previousCounts: { chat_messages_unread_total: 5, chat_conversations_unread: 1 },
      chatWsEnabled: true,
    });
    expect(next.chat_messages_unread_total).toBe(5);
    expect(next.chat_conversations_unread).toBe(1);
  });
});

describe('shouldNotifyMailArrival', () => {
  it('fires only when resolved, baseline exists and count grew', () => {
    expect(shouldNotifyMailArrival({ resolved: true, hadBaseline: true, nextUnread: 5, previousUnread: 4 })).toBe(true);
    expect(shouldNotifyMailArrival({ resolved: true, hadBaseline: false, nextUnread: 5, previousUnread: 0 })).toBe(false);
    expect(shouldNotifyMailArrival({ resolved: false, hadBaseline: true, nextUnread: 5, previousUnread: 0 })).toBe(false);
    expect(shouldNotifyMailArrival({ resolved: true, hadBaseline: true, nextUnread: 4, previousUnread: 4 })).toBe(false);
  });
});

describe('applyMailUnreadDeltaToCounts', () => {
  it('shifts mail unread and the total badge together', () => {
    const prev = { notifications_unread_total: 10, mail_unread: 4, mail_state: 'ok' };
    const applied = applyMailUnreadDeltaToCounts(prev, -1);
    expect(applied.nextCounts.mail_unread).toBe(3);
    expect(applied.nextCounts.notifications_unread_total).toBe(9);
    expect(applied.nextCounts.mail_state).toBe('ok');
  });

  it('never goes below zero and returns null for no-op deltas', () => {
    const applied = applyMailUnreadDeltaToCounts({ notifications_unread_total: 2, mail_unread: 2 }, -9);
    expect(applied.nextCounts.mail_unread).toBe(0);
    expect(applied.nextCounts.notifications_unread_total).toBe(0);
    expect(applyMailUnreadDeltaToCounts({}, 0)).toBeNull();
    expect(applyMailUnreadDeltaToCounts({}, 'x')).toBeNull();
  });
});

describe('resolveChatUnreadDeltaToast', () => {
  const base = { chatMessagesUnreadTotal: 6, previousChatMessagesUnread: 4, hadBaseline: true, isVisible: true, isOnChatRoute: false };

  it('returns baselineOnly on the first fetch', () => {
    expect(resolveChatUnreadDeltaToast({ ...base, hadBaseline: false })).toEqual({ baselineOnly: true });
  });

  it('builds a pluralized toast for visible surfaces outside /chat', () => {
    const d = resolveChatUnreadDeltaToast(base);
    expect(d.message).toBe('Новые сообщения в чате: 2');
    expect(d.options.dedupeKey).toBe('chat-unread-delta:6');
    expect(d.options.action.to).toBe('/chat');
  });

  it('uses singular copy for one message', () => {
    expect(resolveChatUnreadDeltaToast({ ...base, chatMessagesUnreadTotal: 5 }).message)
      .toBe('Новое сообщение в чате');
  });

  it('stays silent on /chat, hidden surface or no growth', () => {
    expect(resolveChatUnreadDeltaToast({ ...base, isOnChatRoute: true })).toBeNull();
    expect(resolveChatUnreadDeltaToast({ ...base, isVisible: false })).toBeNull();
    expect(resolveChatUnreadDeltaToast({ ...base, chatMessagesUnreadTotal: 4 })).toBeNull();
  });
});
