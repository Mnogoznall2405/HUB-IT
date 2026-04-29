import { describe, expect, it, vi } from 'vitest';

import {
  buildCursorInvalidThreadReloadOptions,
  buildActiveThreadPollLoadOptions,
  buildAiLiveDataNotice,
  buildAiSidebarRows,
  buildAiStatusDisplayModel,
  getChatBottomInstantSettleFrames,
  buildConversationFilterCounts,
  canUseAiChatPermission,
  filterSidebarConversations,
  getLatestPersistedThreadMessageId,
  isRegularSidebarConversation,
  mergeAiStatusPayload,
  normalizeForwardMessageQueue,
  resolveActiveAiBotRecord,
  resolveActiveThreadTransportState,
  shouldDeferChatUrlSyncForRequestedConversation,
  shouldSkipActiveThreadRevalidate,
  shouldPollActiveThreadIncrementally,
  shouldPollActiveAiThread,
  shouldRequestConversationAiStatus,
} from './Chat';

describe('Chat page AI helpers', () => {
  it('settles user-initiated instant bottom scroll for outgoing messages', () => {
    expect(getChatBottomInstantSettleFrames({ userInitiated: true })).toBe(2);
    expect(getChatBottomInstantSettleFrames({ userInitiated: false })).toBe(1);
  });

  it('builds lightweight active-thread poll requests from the latest loaded message', () => {
    expect(buildActiveThreadPollLoadOptions('msg-42')).toEqual({
      silent: true,
      afterMessageId: 'msg-42',
      reason: 'poll:active-thread:newer',
    });

    expect(buildActiveThreadPollLoadOptions('')).toEqual({
      silent: true,
      reason: 'poll:active-thread:bootstrap',
      force: true,
    });
  });

  it('defers desktop URL sync while a notification deep-link conversation is being applied', () => {
    expect(shouldDeferChatUrlSyncForRequestedConversation({
      applyingRequestedConversationId: 'conv-b',
      activeConversationId: 'conv-a',
    })).toBe(true);

    expect(shouldDeferChatUrlSyncForRequestedConversation({
      applyingRequestedConversationId: 'conv-b',
      activeConversationId: 'conv-b',
    })).toBe(false);

    expect(shouldDeferChatUrlSyncForRequestedConversation({
      applyingRequestedConversationId: '',
      activeConversationId: 'conv-a',
    })).toBe(false);
  });

  it('skips active-thread revalidation when a fresh socket message is already rendered', () => {
    const now = Date.now();
    expect(shouldSkipActiveThreadRevalidate({
      activeConversationId: 'conv-1',
      conversationId: 'conv-1',
      reason: 'message_created',
      messages: [{ id: 'msg-2', isOptimistic: false }],
      latestSocketMessage: { conversationId: 'conv-1', messageId: 'msg-2', at: now - 250 },
      now,
    })).toBe(true);

    expect(shouldSkipActiveThreadRevalidate({
      activeConversationId: 'conv-1',
      conversationId: 'conv-1',
      reason: 'message_created',
      messages: [{ id: 'msg-2', isOptimistic: false }],
      latestSocketMessage: { conversationId: 'conv-1', messageId: 'msg-2', at: now - 10_000 },
      now,
    })).toBe(false);

    expect(shouldSkipActiveThreadRevalidate({
      activeConversationId: 'conv-1',
      conversationId: 'conv-2',
      reason: 'message_created',
      messages: [{ id: 'msg-2', isOptimistic: false }],
      latestSocketMessage: { conversationId: 'conv-1', messageId: 'msg-2', at: now },
      now,
    })).toBe(false);
  });

  it('ignores optimistic placeholders when choosing the active-thread poll cursor', () => {
    const messages = [
      { id: 'msg-41' },
      { id: 'optimistic:ai-conv-1:1' },
      { id: 'msg-42' },
      { id: 'optimistic:ai-conv-1:2' },
    ];

    expect(getLatestPersistedThreadMessageId(messages)).toBe('msg-42');
    expect(buildActiveThreadPollLoadOptions(messages)).toEqual({
      silent: true,
      afterMessageId: 'msg-42',
      reason: 'poll:active-thread:newer',
    });
    expect(buildActiveThreadPollLoadOptions([{ id: 'optimistic:ai-conv-1:3' }])).toEqual({
      silent: true,
      reason: 'poll:active-thread:bootstrap',
      force: true,
    });
  });

  it('builds a silent full reload when the backend flags an invalid thread cursor', () => {
    expect(buildCursorInvalidThreadReloadOptions('poll:active-thread:newer')).toEqual({
      silent: true,
      force: true,
      reason: 'poll:active-thread:newer:cursor-invalid',
    });
  });

  it('grants AI chat access only when the permission function allows chat.ai.use', () => {
    expect(canUseAiChatPermission()).toBe(false);
    expect(canUseAiChatPermission(() => false)).toBe(false);

    const hasPermission = vi.fn((permission) => permission === 'chat.ai.use');

    expect(canUseAiChatPermission(hasPermission)).toBe(true);
    expect(hasPermission).toHaveBeenCalledWith('chat.ai.use');
  });

  it('requests conversation AI status only for AI dialogs with a real id and permission', () => {
    expect(shouldRequestConversationAiStatus({
      conversationId: '',
      conversationKind: 'ai',
      canUseAiChat: true,
    })).toBe(false);

    expect(shouldRequestConversationAiStatus({
      conversationId: 'conv-1',
      conversationKind: 'direct',
      canUseAiChat: true,
    })).toBe(false);

    expect(shouldRequestConversationAiStatus({
      conversationId: 'conv-1',
      conversationKind: 'ai',
      canUseAiChat: false,
    })).toBe(false);

    expect(shouldRequestConversationAiStatus({
      conversationId: 'ai-conv-1',
      conversationKind: 'ai',
      canUseAiChat: true,
    })).toBe(true);
  });

  it('merges websocket AI status payloads by conversation id and ignores empty updates', () => {
    const current = {
      'ai-conv-1': {
        conversation_id: 'ai-conv-1',
        status: 'queued',
        run_id: 'run-1',
      },
    };

    expect(mergeAiStatusPayload(current, null)).toEqual(current);
    expect(mergeAiStatusPayload(current, {})).toEqual(current);

    expect(mergeAiStatusPayload(current, {
      conversation_id: 'ai-conv-1',
      status: 'running',
      run_id: 'run-1',
    })).toEqual({
      'ai-conv-1': {
        conversation_id: 'ai-conv-1',
        status: 'running',
        run_id: 'run-1',
      },
    });

    expect(mergeAiStatusPayload({}, {
      status: 'failed',
      error_text: 'Model unavailable',
    }, 'ai-conv-2')).toEqual({
      'ai-conv-2': {
        status: 'failed',
        error_text: 'Model unavailable',
      },
    });
  });

  it('builds a visible AI display model from staged backend statuses', () => {
    expect(buildAiStatusDisplayModel({
      status: 'running',
      stage: 'retrieving_kb',
      status_text: '',
    })).toEqual(expect.objectContaining({
      visible: true,
      tone: 'info',
      primaryText: 'Проверяю базу знаний и документы.',
      secondaryText: '',
      showSpinner: true,
    }));

    expect(buildAiStatusDisplayModel({
      status: 'failed',
      stage: 'failed',
      status_text: 'Не удалось обработать запрос.',
      error_text: 'OpenRouter unavailable',
    })).toEqual(expect.objectContaining({
      visible: true,
      tone: 'error',
      primaryText: 'Не удалось обработать запрос.',
      secondaryText: 'OpenRouter unavailable',
      showSpinner: false,
    }));

    expect(buildAiStatusDisplayModel({
      status: 'completed',
      stage: 'completed',
      status_text: '',
    })).toEqual(expect.objectContaining({
      visible: false,
      showSpinner: false,
    }));
  });

  it('marks the active thread transport healthy only when websocket activity is recent', () => {
    const now = Date.now();

    expect(resolveActiveThreadTransportState({
      activeConversationId: 'conv-1',
      socketStatus: 'connected',
      lastSocketActivityAt: now,
      now,
    })).toBe('healthy');

    expect(resolveActiveThreadTransportState({
      activeConversationId: 'conv-1',
      socketStatus: 'connected',
      lastSocketActivityAt: now - 120_000,
      now,
    })).toBe('degraded');

    expect(resolveActiveThreadTransportState({
      activeConversationId: 'conv-1',
      socketStatus: 'reconnecting',
      lastSocketActivityAt: now,
      now,
    })).toBe('degraded');

    expect(resolveActiveThreadTransportState({
      activeConversationId: 'conv-1',
      socketStatus: 'disconnected',
      lastSocketActivityAt: now,
      now,
    })).toBe('offline');
  });

  it('polls the active thread only when transport is degraded or offline', () => {
    expect(shouldPollActiveThreadIncrementally({
      activeConversationId: 'conv-1',
      transportState: 'healthy',
    })).toBe(false);

    expect(shouldPollActiveThreadIncrementally({
      activeConversationId: 'conv-1',
      transportState: 'degraded',
    })).toBe(true);

    expect(shouldPollActiveThreadIncrementally({
      activeConversationId: 'conv-1',
      transportState: 'offline',
    })).toBe(true);
  });

  it('enables AI status polling only while the run is active or transport is unhealthy', () => {
    expect(shouldPollActiveAiThread({
      activeConversationId: 'ai-conv-1',
      activeConversationKind: 'ai',
      aiStatus: { status: 'running' },
      canUseAiChat: true,
      transportState: 'healthy',
      socketStatus: 'connected',
    })).toBe(true);

    expect(shouldPollActiveAiThread({
      activeConversationId: 'ai-conv-1',
      activeConversationKind: 'ai',
      aiStatus: { status: 'completed' },
      canUseAiChat: true,
      transportState: 'offline',
      socketStatus: 'disconnected',
    })).toBe(true);

    expect(shouldPollActiveAiThread({
      activeConversationId: 'ai-conv-1',
      activeConversationKind: 'ai',
      aiStatus: { status: 'completed' },
      canUseAiChat: true,
      transportState: 'healthy',
      socketStatus: 'connected',
    })).toBe(false);

    expect(shouldPollActiveAiThread({
      activeConversationId: 'direct-1',
      activeConversationKind: 'direct',
      aiStatus: { status: 'running' },
      canUseAiChat: true,
      transportState: 'offline',
      socketStatus: 'disconnected',
    })).toBe(false);
  });

  it('excludes AI conversations from the regular sidebar filters and counters', () => {
    const conversations = [
      { id: 'direct-1', kind: 'direct', is_archived: false, unread_count: 2, is_pinned: false },
      { id: 'group-1', kind: 'group', is_archived: false, unread_count: 0, is_pinned: true },
      { id: 'ai-1', kind: 'ai', is_archived: false, unread_count: 9, is_pinned: true },
      { id: 'archived-1', kind: 'group', is_archived: true, unread_count: 0, is_pinned: false },
    ];

    expect(isRegularSidebarConversation(conversations[0])).toBe(true);
    expect(isRegularSidebarConversation(conversations[2])).toBe(false);
    expect(buildConversationFilterCounts(conversations)).toEqual({
      all: 2,
      unread: 1,
      direct: 1,
      group: 1,
      pinned: 1,
      archived: 1,
    });
    expect(filterSidebarConversations(conversations, 'all').map((item) => item.id)).toEqual(['direct-1', 'group-1']);
    expect(filterSidebarConversations(conversations, 'group').map((item) => item.id)).toEqual(['group-1']);
  });

  it('normalizes single and selected forwards into the same ordered message queue', () => {
    const first = { id: 'msg-1', body: 'One' };
    const second = { id: 'msg-2', body: 'Two' };

    expect(normalizeForwardMessageQueue(first)).toEqual([first]);
    expect(normalizeForwardMessageQueue([first, null, { id: '' }, second, first])).toEqual([first, second]);
  });

  it('builds AI sidebar rows from bot records and existing AI conversations', () => {
    const rows = buildAiSidebarRows({
      aiBots: [
        {
          id: 'bot-1',
          title: 'AI Assistant',
          slug: 'ai-assistant',
          description: 'KB bot',
          conversation_id: 'ai-conv-1',
        },
        {
          id: 'bot-2',
          title: 'Fresh Bot',
          slug: 'fresh-bot',
          description: 'Ready to help',
          conversation_id: '',
        },
      ],
      conversations: [{
        id: 'ai-conv-1',
        kind: 'ai',
        title: 'AI Assistant',
        last_message_preview: 'Последний ответ',
        last_message_at: '2026-04-21T12:45:00Z',
        updated_at: '2026-04-21T12:45:00Z',
        unread_count: 3,
        is_pinned: false,
        is_muted: false,
        is_archived: false,
      }],
      draftsByConversation: {
        'ai-conv-1': 'новый запрос',
      },
      activeConversationId: 'ai-conv-1',
    });

    expect(rows[0]).toEqual(expect.objectContaining({
      id: 'bot-1',
      conversation_id: 'ai-conv-1',
      title: 'AI Assistant',
      last_message_preview: 'Последний ответ',
      unread_count: 3,
      draft_preview: 'новый запрос',
      is_active: true,
    }));
    expect(rows[1]).toEqual(expect.objectContaining({
      id: 'bot-2',
      conversation_id: '',
      title: 'Fresh Bot',
      unread_count: 0,
      draft_preview: '',
      is_active: false,
    }));
  });

  it('does not show a live ITinvent access warning in active AI chats', () => {
    const aiBots = [
      {
        id: 'bot-1',
        title: 'Corp Assistant',
        conversation_id: 'ai-conv-1',
        live_data_enabled: false,
      },
      {
        id: 'bot-2',
        title: 'Second Bot',
        conversation_id: 'ai-conv-2',
        live_data_enabled: true,
      },
    ];

    expect(resolveActiveAiBotRecord({
      aiBots,
      activeConversationId: 'ai-conv-1',
      aiStatus: { bot_id: 'bot-1' },
    })).toEqual(expect.objectContaining({
      id: 'bot-1',
      live_data_enabled: false,
    }));

    expect(buildAiLiveDataNotice({
      activeConversationKind: 'ai',
      activeConversationId: 'ai-conv-1',
      aiStatus: { bot_id: 'bot-1', bot_title: 'Corp Assistant' },
      aiBots,
    })).toBeNull();

    expect(buildAiLiveDataNotice({
      activeConversationKind: 'ai',
      activeConversationId: 'ai-conv-2',
      aiStatus: { bot_id: 'bot-2', bot_title: 'Second Bot' },
      aiBots,
    })).toBeNull();

    expect(buildAiLiveDataNotice({
      activeConversationKind: 'direct',
      activeConversationId: 'ai-conv-1',
      aiStatus: { bot_id: 'bot-1' },
      aiBots,
    })).toBeNull();
  });
});
