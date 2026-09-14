import { describe, expect, it } from 'vitest';

import {
  buildMailArrivalToastPayload,
  resolveForegroundPushDecision,
  resolveMailArrivalDelivery,
} from './layoutPushDecisions';

describe('resolveForegroundPushDecision', () => {
  const chat = { channel: 'chat', title: 'Иван', body: 'привет', data: { conversation_id: 'c1', message_id: 'm1' } };

  it('suppresses chat push when the socket is already connected', () => {
    expect(resolveForegroundPushDecision(chat, { skipChatPush: true }))
      .toEqual({ kind: 'suppress', reason: 'chat_socket_connected' });
  });

  it('suppresses on a visible mobile chat route', () => {
    const d = resolveForegroundPushDecision(chat, { isMobileChatRoute: true, isVisible: true });
    expect(d).toEqual({ kind: 'suppress', reason: 'mobile_chat_route_visible' });
  });

  it('suppresses for the active visible conversation', () => {
    const d = resolveForegroundPushDecision(chat, {
      isChatRoute: true,
      isVisible: true,
      activeChatConversationId: 'c1',
    });
    expect(d).toEqual({ kind: 'suppress', reason: 'active_visible_conversation' });
  });

  it('returns a claim-chat toast for a new conversation message', () => {
    const d = resolveForegroundPushDecision(chat, { activeChatConversationId: 'other' });
    expect(d.kind).toBe('claim-chat');
    expect(d.messageId).toBe('m1');
    expect(d.body).toBe('привет');
    expect(d.options).toMatchObject({ source: 'chat', dedupeKey: 'chat:m1', title: 'Иван' });
    expect(d.options.action).toMatchObject({ kind: 'navigate' });
  });

  it('builds a mail toast with a deep link', () => {
    const d = resolveForegroundPushDecision({
      channel: 'mail', title: 'Почта', body: 'новое', route: '/mail?message=42',
    });
    expect(d.kind).toBe('toast');
    expect(d.options).toMatchObject({ source: 'mail', dedupeKey: 'mail:/mail?message=42' });
    expect(d.options.action).toMatchObject({ kind: 'navigate', to: '/mail?message=42' });
  });

  it('uses per-channel labels for hub channels', () => {
    const tasks = resolveForegroundPushDecision({ channel: 'tasks', body: 'задача', data: { notification_id: 'n1' } });
    expect(tasks.options.action.label).toBe('Открыть задачу');
    expect(tasks.options.dedupeKey).toBe('hub:n1');
    const news = resolveForegroundPushDecision({ channel: 'announcements', body: 'новость' });
    expect(news.options.action.label).toBe('Открыть публикацию');
  });
});

describe('resolveMailArrivalDelivery', () => {
  it('delivers toast when the app surface is visible', () => {
    expect(resolveMailArrivalDelivery({ isVisible: true })).toBe('toast');
  });

  it('suppresses local system notification when push is already covering it', () => {
    expect(resolveMailArrivalDelivery({
      isVisible: false, pushSubscribed: true, backgroundCapable: true,
    })).toBe('suppress');
  });

  it('uses a system notification when hidden and granted', () => {
    expect(resolveMailArrivalDelivery({
      isVisible: false,
      windowsState: { enabled: true, permission: 'granted' },
    })).toBe('system');
  });

  it('falls back to silent suppress when nothing is available', () => {
    expect(resolveMailArrivalDelivery({
      isVisible: false,
      windowsState: { enabled: false, permission: 'denied' },
    })).toBe('suppress');
  });
});

describe('buildMailArrivalToastPayload', () => {
  it('builds a deep-link toast for a feed item', () => {
    const payload = buildMailArrivalToastPayload(
      { id: 'm-7', folder: 'inbox', mailbox_id: 'mb-2' },
      { notificationId: 'n-7', title: 'От: Иван', body: 'тема' },
    );
    expect(payload.messageId).toBe('m-7');
    expect(payload.route).toBe('/mail?folder=inbox&message=m-7&mailbox_id=mb-2');
    expect(payload.toastOptions.dedupeKey).toBe('mail:n-7');
    expect(payload.toastOptions.action.to).toBe(payload.route);
  });

  it('returns null for items without id or notificationId', () => {
    expect(buildMailArrivalToastPayload({}, { notificationId: 'n' })).toBeNull();
    expect(buildMailArrivalToastPayload({ id: 'm' }, { notificationId: '' })).toBeNull();
  });
});
