import { describe, expect, it, vi } from 'vitest';

vi.mock('./chatNotifications', () => ({
  buildChatNotificationRoute: vi.fn(({ conversationId }) => `/chat/${conversationId}`),
  resolveChatNotificationSenderName: vi.fn(() => 'Иван Петров'),
  shouldDeliverExternalChatViaPushOnly: vi.fn((state) => Boolean(state?.pushSubscribed)),
}));

vi.mock('../components/chat/chatHelpers', () => ({
  getMessagePreview: vi.fn((message) => String(message?.text || 'сообщение')),
}));

import { resolveChatMessageNotificationPlan } from './chatSocketNotificationPlan';

const envelope = {
  conversation_id: 'c1',
  payload: { id: 'm1', text: 'привет', conversation_kind: 'direct' },
};

const visibleCtx = {
  userId: 9,
  isVisible: true,
  chatChannelEnabled: true,
  chatNotificationState: { permission: 'granted' },
};

describe('resolveChatMessageNotificationPlan', () => {
  it('ignores malformed, own or id-less envelopes', () => {
    expect(resolveChatMessageNotificationPlan({}).kind).toBe('ignore');
    expect(resolveChatMessageNotificationPlan({
      conversation_id: 'c1',
      payload: { id: 'm1', is_own: true },
    }).kind).toBe('ignore');
  });

  it('suppresses muted conversations unless the user is mentioned', () => {
    expect(resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isConversationMuted: true,
    })).toEqual({ kind: 'suppress', reason: 'conversation_muted' });

    const mentioned = {
      conversation_id: 'c1',
      payload: { id: 'm1', mentioned_user_ids: [9] },
    };
    expect(resolveChatMessageNotificationPlan(mentioned, {
      ...visibleCtx, isConversationMuted: true,
    }).kind).toBe('plan');
  });

  it('suppresses the active visible conversation after claim', () => {
    const plan = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isChatRoute: true, activeChatConversationId: 'c1',
    });
    expect(plan.kind).toBe('plan');
    expect(plan.suppress).toBe('active_visible_conversation');
    expect(plan.toast).toBeNull();
  });

  it('suppresses on mobile chat route and when the channel is disabled', () => {
    expect(resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isMobileChatRoute: true,
    }).suppress).toBe('mobile_chat_route_visible');
    expect(resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, chatChannelEnabled: false,
    }).suppress).toBe('notifications_disabled');
  });

  it('N2: suppresses the toast for another conversation on the desktop chat page', () => {
    const plan = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isChatRoute: true, isDesktopChatRoute: true,
      activeChatConversationId: 'other-conv',
    });
    expect(plan.kind).toBe('plan');
    expect(plan.suppress).toBe('desktop_chat_route');
    expect(plan.toast).toBeNull();
  });

  it('N2: still suppresses on desktop chat page but keeps the sound allowed', () => {
    const plan = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isChatRoute: true, isDesktopChatRoute: true,
      chatMessageSoundEnabled: true,
    });
    expect(plan.suppress).toBe('desktop_chat_route');
    expect(plan.shouldPlaySound).toBe(true);
  });

  it('N1: plays sound for a fresh message unless muted/off/active-visible', () => {
    const sounding = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isChatRoute: true, isDesktopChatRoute: true,
      chatMessageSoundEnabled: true,
    });
    expect(sounding.shouldPlaySound).toBe(true);

    const soundOff = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, chatMessageSoundEnabled: false,
    });
    expect(soundOff.shouldPlaySound).toBe(false);

    const activeVisible = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isChatRoute: true, activeChatConversationId: 'c1',
      chatMessageSoundEnabled: true,
    });
    expect(activeVisible.shouldPlaySound).toBe(false);

    const channelOff = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, chatChannelEnabled: false,
      chatMessageSoundEnabled: true,
    });
    expect(channelOff.shouldPlaySound).toBe(false);
  });

  it('exposes the resolved sender name for the hidden-tab title (N3)', () => {
    const plan = resolveChatMessageNotificationPlan(envelope, visibleCtx);
    expect(plan.senderName).toBe('Иван Петров');
  });

  it('shows a toast for a visible surface', () => {
    const plan = resolveChatMessageNotificationPlan(envelope, visibleCtx);
    expect(plan.toast).toMatchObject({ body: 'привет' });
    expect(plan.toast.options).toMatchObject({
      title: 'Иван Петров',
      dedupeKey: 'chat:m1',
    });
    expect(plan.toast.options.action.to).toBe('/chat/c1');
  });

  it('requests a system notification when hidden, granted and not push-only', () => {
    const plan = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isVisible: false,
    });
    expect(plan.system).toMatchObject({
      messageId: 'm1', conversationId: 'c1', title: 'Иван Петров', navigateTo: '/chat/c1',
    });
    expect(plan.shouldShowLocalSystemNotification).toBe(true);
  });

  it('skips system notification when push covers delivery', () => {
    const plan = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx, isVisible: false,
      chatNotificationState: { permission: 'granted', pushSubscribed: true },
    });
    expect(plan.system).toBeNull();
    expect(plan.shouldShowLocalSystemNotification).toBe(false);
  });

  it('reports permission_not_granted after the toast', () => {
    const plan = resolveChatMessageNotificationPlan(envelope, {
      ...visibleCtx,
      chatNotificationState: { permission: 'denied' },
    });
    expect(plan.toast).not.toBeNull();
    expect(plan.reason).toBe('permission_not_granted');
  });

  it('AG: an AI answer is announced as "ИИ ответил: <beginning>" with sound, toast and OS notification', () => {
    const aiEnvelope = {
      conversation_id: 'ai1',
      payload: {
        id: 'm9',
        conversation_kind: 'ai',
        text: '**Готово**: принтер [настроен](https://x.y/z). _Учтена личная память: 1 факт_',
      },
    };
    const plan = resolveChatMessageNotificationPlan(aiEnvelope, {
      ...visibleCtx,
      isVisible: false,
      chatMessageSoundEnabled: true,
    });
    expect(plan.senderName).toBe('ИИ ответил');
    expect(plan.shouldPlaySound).toBe(true);
    expect(plan.system).toMatchObject({ title: 'ИИ ответил', body: 'Готово: принтер настроен.' });

    const visible = resolveChatMessageNotificationPlan(aiEnvelope, visibleCtx);
    expect(visible.toast.options.title).toBe('ИИ ответил');
    expect(visible.toast.body).toBe('Готово: принтер настроен.');
  });
});
