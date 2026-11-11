import { describe, expect, it } from 'vitest';

import {
  buildChatConversationsCacheKeyParts,
  buildChatThreadCacheKeyParts,
  getChatBottomInstantSettleFrames,
  hasPersistedThreadMessageEquivalent,
  reconcileThreadMessages,
  resolveActiveThreadTransportState,
  shouldShowOlderHistoryControl,
  threadFitsSingleBootstrapPage,
} from './chatModel';

describe('chatModel barrel exports', () => {
  it('builds stable cache key parts', () => {
    expect(buildChatConversationsCacheKeyParts(7)).toEqual(['chat', 'conversations', '7']);
    expect(buildChatThreadCacheKeyParts(7, 'conv-1')).toEqual(['chat', 'thread', '7', 'conv-1', 'latest']);
  });

  it('settles bottom scroll frames for outgoing messages', () => {
    expect(getChatBottomInstantSettleFrames({ userInitiated: true })).toBe(2);
    expect(getChatBottomInstantSettleFrames({ userInitiated: false })).toBe(1);
  });

  it('resolves thread transport state for connected socket', () => {
    expect(resolveActiveThreadTransportState({
      activeConversationId: 'conv-1',
      socketStatus: 'connected',
      lastSocketActivityAt: Date.now(),
      chatWsEnabled: true,
      chatFeatureEnabled: true,
    })).toBe('healthy');
  });

  it('replaces thread window by default', () => {
    const current = [{ id: 'msg-1', created_at: '2026-04-28T08:00:00.000Z', body: 'a' }];
    const incoming = [{ id: 'msg-2', created_at: '2026-04-28T08:01:00.000Z', body: 'b' }];
    const next = reconcileThreadMessages(current, incoming, { conversationId: 'conv-1' });
    expect(next.map((item) => item.id)).toEqual(['msg-2']);
  });

  it('preserves loaded older messages when reconciling latest window', () => {
    const current = [{
      id: 'msg-1',
      conversation_id: 'conv-1',
      created_at: '2026-04-28T08:00:00.000Z',
      body: 'a',
    }];
    const incoming = [{
      id: 'msg-2',
      conversation_id: 'conv-1',
      created_at: '2026-04-28T08:01:00.000Z',
      body: 'b',
    }];
    const next = reconcileThreadMessages(current, incoming, {
      conversationId: 'conv-1',
      mode: 'replaceWindowButPreserveFreshLocal',
    });
    expect(next.map((item) => item.id)).toEqual(['msg-1', 'msg-2']);
  });

  it('detects already persisted thread messages for socket dedupe', () => {
    const persisted = {
      id: 'msg-1',
      client_message_id: 'client-1',
      body: 'hello',
      created_at: '2026-04-28T08:00:00.000Z',
    };
    const socketPayload = {
      id: 'msg-1',
      client_message_id: 'client-1',
      body: 'hello',
      created_at: '2026-04-28T08:00:00.000Z',
    };
    expect(hasPersistedThreadMessageEquivalent([persisted], socketPayload)).toBe(true);
    expect(hasPersistedThreadMessageEquivalent([
      {
        id: 'optimistic:conv-1:1',
        isOptimistic: true,
        optimisticStatus: 'sending',
        body: 'hello',
      },
    ], socketPayload)).toBe(false);
  });

  it('hides older-history control for short bootstrap pages', () => {
    expect(threadFitsSingleBootstrapPage(12)).toBe(true);
    expect(shouldShowOlderHistoryControl({
      messagesHasMore: true,
      messageCount: 12,
      olderHistoryUnavailable: false,
    })).toBe(false);
    expect(shouldShowOlderHistoryControl({
      messagesHasMore: true,
      messageCount: 40,
      olderHistoryUnavailable: false,
    })).toBe(true);
  });
});
