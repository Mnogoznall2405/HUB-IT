import { describe, expect, it } from 'vitest';

import {
  buildChatConversationsCacheKeyParts,
  buildChatLastConversationSessionKey,
  buildChatLastMobileViewSessionKey,
  buildChatThreadCacheKeyParts,
  reconcileThreadMessages,
  shouldSkipActiveThreadRevalidate,
} from './Chat';

describe('Chat page cache helpers', () => {
  it('builds stable conversations and thread cache keys', () => {
    expect(buildChatConversationsCacheKeyParts(7)).toEqual(['chat', 'conversations', '7']);
    expect(buildChatConversationsCacheKeyParts()).toEqual(['chat', 'conversations', 'guest']);

    expect(buildChatThreadCacheKeyParts(7, 'conv-1')).toEqual([
      'chat',
      'thread',
      '7',
      'conv-1',
      'latest',
    ]);
    expect(buildChatThreadCacheKeyParts(null, ' conv-2 ')).toEqual([
      'chat',
      'thread',
      'guest',
      'conv-2',
      'latest',
    ]);
  });

  it('builds stable session storage keys for conversation restore and mobile view', () => {
    expect(buildChatLastConversationSessionKey(7)).toBe('chat:last-conversation:7');
    expect(buildChatLastConversationSessionKey()).toBe('chat:last-conversation:guest');

    expect(buildChatLastMobileViewSessionKey(7)).toBe('chat:last-mobile-view:7');
    expect(buildChatLastMobileViewSessionKey()).toBe('chat:last-mobile-view:guest');
  });

  it('dedupes active-thread socket revalidation after a rendered message_created event', () => {
    const now = 1_800_000;
    expect(shouldSkipActiveThreadRevalidate({
      activeConversationId: 'conv-1',
      conversationId: 'conv-1',
      reason: 'updated',
      messages: [{ id: 'msg-10', isOptimistic: false }],
      latestSocketMessage: { conversationId: 'conv-1', messageId: 'msg-10', at: now - 100 },
      now,
    })).toBe(true);

    expect(shouldSkipActiveThreadRevalidate({
      activeConversationId: 'conv-1',
      conversationId: 'conv-1',
      reason: 'settings_updated',
      messages: [{ id: 'msg-10', isOptimistic: false }],
      latestSocketMessage: { conversationId: 'conv-1', messageId: 'msg-10', at: now - 100 },
      now,
    })).toBe(false);
  });

  it('preserves fresh local socket messages when a stale latest payload is applied', () => {
    const current = [
      { id: 'msg-1', conversation_id: 'conv-1', body: 'old', created_at: '2026-04-28T08:00:00.000Z' },
      { id: 'msg-2', conversation_id: 'conv-1', body: 'socket fresh', created_at: '2026-04-28T08:01:00.000Z' },
    ];
    const staleLatestPayload = [
      { id: 'msg-1', conversation_id: 'conv-1', body: 'old', created_at: '2026-04-28T08:00:00.000Z' },
    ];

    const next = reconcileThreadMessages(current, staleLatestPayload, {
      conversationId: 'conv-1',
      mode: 'replaceWindowButPreserveFreshLocal',
    });

    expect(next.map((message) => message.id)).toEqual(['msg-1', 'msg-2']);
  });

  it('does not preserve older local messages outside the latest payload window', () => {
    const current = [
      { id: 'msg-1', conversation_id: 'conv-1', body: 'older loaded page', created_at: '2026-04-28T07:59:00.000Z' },
      { id: 'msg-2', conversation_id: 'conv-1', body: 'latest', created_at: '2026-04-28T08:00:00.000Z' },
    ];
    const latestPayload = [
      { id: 'msg-2', conversation_id: 'conv-1', body: 'latest', created_at: '2026-04-28T08:00:00.000Z' },
    ];

    const next = reconcileThreadMessages(current, latestPayload, {
      conversationId: 'conv-1',
      mode: 'replaceWindowButPreserveFreshLocal',
    });

    expect(next.map((message) => message.id)).toEqual(['msg-2']);
  });
});
