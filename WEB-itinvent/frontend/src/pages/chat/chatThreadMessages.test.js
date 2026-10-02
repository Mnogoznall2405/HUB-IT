import { describe, expect, it } from 'vitest';

import {
  areThreadMessagesEquivalent,
  compareThreadMessagePosition,
  getLatestPersistedThreadMessageId,
  hasPersistedThreadMessageEquivalent,
  isFailedOptimisticThreadMessage,
  isSendingOptimisticThreadMessage,
  reconcileThreadMessages,
  resolveActiveThreadRenderState,
  sortThreadMessages,
  withPreservedThreadRenderKey,
} from './chatThreadMessages';

const baseMessage = (overrides = {}) => ({
  id: 'msg-1',
  conversation_id: 'conv-1',
  body: 'hello',
  created_at: '2026-06-27T10:00:00',
  ...overrides,
});

describe('chatThreadMessages', () => {
  describe('resolveActiveThreadRenderState', () => {
    it('does not expose messages from the previously hydrated conversation', () => {
      const staleMessages = Array.from({ length: 500 }, (_, index) => baseMessage({
        id: `msg-${index}`,
        conversation_id: 'conv-1',
      }));

      const result = resolveActiveThreadRenderState({
        activeConversationId: 'conv-2',
        hydratedConversationId: 'conv-1',
        messages: staleMessages,
        messagesLoading: false,
      });

      expect(result.messages).toHaveLength(0);
      expect(result.loading).toBe(true);
    });

    it('keeps the message array reference once the active thread is hydrated', () => {
      const messages = [baseMessage()];

      const result = resolveActiveThreadRenderState({
        activeConversationId: 'conv-1',
        hydratedConversationId: 'conv-1',
        messages,
        messagesLoading: false,
      });

      expect(result.messages).toBe(messages);
      expect(result.loading).toBe(false);
    });
  });

  describe('isSendingOptimisticThreadMessage', () => {
    it('returns true for sending optimistic messages in the active conversation', () => {
      expect(isSendingOptimisticThreadMessage({
        isOptimistic: true,
        optimisticStatus: 'sending',
        conversation_id: 'conv-1',
      }, 'conv-1')).toBe(true);
    });

    it('returns false for failed optimistic messages', () => {
      expect(isSendingOptimisticThreadMessage({
        isOptimistic: true,
        optimisticStatus: 'failed',
        conversation_id: 'conv-1',
      }, 'conv-1')).toBe(false);
    });

    it('returns false for sending optimistic messages in another conversation', () => {
      expect(isSendingOptimisticThreadMessage({
        isOptimistic: true,
        optimisticStatus: 'sending',
        conversation_id: 'conv-2',
      }, 'conv-1')).toBe(false);
    });
  });

  describe('isFailedOptimisticThreadMessage', () => {
    it('returns true only for failed optimistic messages in the conversation', () => {
      expect(isFailedOptimisticThreadMessage({
        isOptimistic: true,
        optimisticStatus: 'failed',
        conversation_id: 'conv-1',
      }, 'conv-1')).toBe(true);
      expect(isFailedOptimisticThreadMessage({
        isOptimistic: true,
        optimisticStatus: 'sending',
        conversation_id: 'conv-1',
      }, 'conv-1')).toBe(false);
      expect(isFailedOptimisticThreadMessage({
        isOptimistic: true,
        optimisticStatus: 'failed',
        conversation_id: 'conv-2',
      }, 'conv-1')).toBe(false);
    });
  });

  describe('areThreadMessagesEquivalent', () => {
    it('treats identical references as equivalent', () => {
      const message = baseMessage();
      expect(areThreadMessagesEquivalent(message, message)).toBe(true);
    });

    it('compares persisted messages by id and signature', () => {
      const left = baseMessage({ body: 'same text' });
      const right = baseMessage({ body: 'same text' });
      expect(areThreadMessagesEquivalent(left, right)).toBe(true);
      expect(areThreadMessagesEquivalent(left, baseMessage({ body: 'different' }))).toBe(false);
    });

    it('detects changes in render-relevant payload fields with the same id', () => {
      const cases = [
        { reactions: [{ emoji: '👍', count: 1, user_ids: [7] }] },
        {
          poll: {
            question: 'Вопрос?',
            options: [{ text: 'да', votes: 1 }, { text: 'нет', votes: 0 }],
            total_voters: 1,
          },
        },
        {
          action_card: {
            action_type: 'it.transfer',
            status: 'confirmed',
            preview: { title: 'Перемещение' },
          },
        },
        { forward_preview: { sender_id: 5, sender_name: 'Иван', body: 'orig' } },
        { is_deleted: true },
        { deleted_at: '2026-06-27T12:00:00' },
        { conversation_seq: 42 },
        { attachments: [{ id: 'a1', width: 640, height: 480 }] },
        { attachments: [{ id: 'a1', duration_seconds: 12 }] },
        { attachments: [{ id: 'a1', variant_urls: { webp: '/v/a.webp' } }] },
      ];
      cases.forEach((overrides) => {
        expect(areThreadMessagesEquivalent(baseMessage(), baseMessage(overrides)))
          .toBe(false);
      });
    });

    it('keeps equivalence when render-relevant payloads are unchanged', () => {
      const payload = {
        reactions: [{ emoji: '👍', count: 2, user_ids: [7, 9] }],
        poll: {
          question: 'Вопрос?',
          options: [{ text: 'да', votes: 1 }, { text: 'нет', votes: 0 }],
          closed: false,
          total_voters: 1,
          my_option_index: 0,
        },
        action_card: { action_type: 'it.transfer', status: 'pending', preview: { title: 'T' } },
        forward_preview: { sender_id: 5, sender_name: 'Иван' },
        conversation_seq: 7,
      };
      const left = baseMessage(payload);
      // Same reaction contents in a different user_ids order must not re-render.
      const right = baseMessage({
        ...payload,
        reactions: [{ emoji: '👍', count: 2, user_ids: [9, 7] }],
        action_card: { status: 'pending', action_type: 'it.transfer', preview: { title: 'T' } },
      });
      expect(areThreadMessagesEquivalent(left, right)).toBe(true);
    });
  });

  describe('compareThreadMessagePosition / sortThreadMessages', () => {
    it('orders by conversation_seq first, then created_at, then id', () => {
      const newer = baseMessage({
        id: 'msg-2',
        created_at: '2026-06-27T10:02:00',
        conversation_seq: 2,
      });
      const older = baseMessage({
        id: 'msg-1',
        created_at: '2026-06-27T10:01:00',
        conversation_seq: 1,
      });
      const outOfOrderDate = baseMessage({
        id: 'msg-3',
        created_at: '2026-06-27T09:00:00',
        conversation_seq: 3,
      });

      expect(sortThreadMessages([newer, outOfOrderDate, older]).map((item) => item.id))
        .toEqual(['msg-1', 'msg-2', 'msg-3']);
      expect(compareThreadMessagePosition(older, newer)).toBeLessThan(0);
    });

    it('keeps optimistic messages without seq after persisted ones', () => {
      const persisted = baseMessage({
        id: 'msg-1',
        created_at: '2026-06-27T10:05:00',
      });
      const optimistic = {
        id: 'optimistic:c1:1',
        conversation_id: 'conv-1',
        isOptimistic: true,
        optimisticStatus: 'failed',
        created_at: '2026-06-27T09:00:00',
      };

      expect(compareThreadMessagePosition(optimistic, persisted)).toBeGreaterThan(0);
      expect(sortThreadMessages([optimistic, persisted]).map((item) => item.id))
        .toEqual(['msg-1', 'optimistic:c1:1']);
    });

    it('falls back to created_at then id for persisted messages without seq', () => {
      const first = baseMessage({ id: 'msg-b', created_at: '2026-06-27T10:00:00' });
      const second = baseMessage({ id: 'msg-a', created_at: '2026-06-27T10:00:00' });
      const later = baseMessage({ id: 'msg-c', created_at: '2026-06-27T10:01:00' });

      expect(sortThreadMessages([later, second, first]).map((item) => item.id))
        .toEqual(['msg-a', 'msg-b', 'msg-c']);
    });
  });

  describe('withPreservedThreadRenderKey', () => {
    it('keeps an existing render key from the prior message', () => {
      const existing = baseMessage({ renderKey: 'render-stable' });
      const incoming = baseMessage({ renderKey: 'render-new' });
      expect(withPreservedThreadRenderKey(incoming, existing)).toEqual(expect.objectContaining({
        renderKey: 'render-stable',
      }));
    });

    it('returns the message unchanged when no render key override is needed', () => {
      const message = baseMessage({ renderKey: 'render-1' });
      expect(withPreservedThreadRenderKey(message)).toBe(message);
    });
  });

  describe('getLatestPersistedThreadMessageId', () => {
    it('ignores optimistic message ids', () => {
      const messages = [
        baseMessage({ id: 'msg-1' }),
        baseMessage({ id: 'optimistic:client-1', isOptimistic: true }),
        baseMessage({ id: 'msg-2' }),
      ];
      expect(getLatestPersistedThreadMessageId(messages)).toBe('msg-2');
    });

    it('returns empty string when only optimistic messages exist', () => {
      expect(getLatestPersistedThreadMessageId([
        baseMessage({ id: 'optimistic:client-1', isOptimistic: true }),
      ])).toBe('');
    });
  });

  describe('reconcileThreadMessages', () => {
    it('preserves sending optimistic messages when server has not echoed them yet', () => {
      const current = [
        baseMessage({ id: 'msg-1', created_at: '2026-06-27T10:00:00' }),
        {
          id: 'optimistic:client-1',
          client_message_id: 'client-1',
          conversation_id: 'conv-1',
          body: 'pending',
          created_at: '2026-06-27T10:01:00',
          isOptimistic: true,
          optimisticStatus: 'sending',
        },
      ];
      const incoming = [
        baseMessage({ id: 'msg-1', created_at: '2026-06-27T10:00:00' }),
      ];

      const next = reconcileThreadMessages(current, incoming, {
        conversationId: 'conv-1',
        preserveSendingOptimistic: true,
      });

      expect(next).toHaveLength(2);
      expect(next.some((item) => item.id === 'optimistic:client-1')).toBe(true);
    });

    it('keeps failed optimistic bubbles on a plain refresh', () => {
      const failedBubble = {
        id: 'optimistic:client-1',
        client_message_id: 'client-1',
        conversation_id: 'conv-1',
        body: 'failed text',
        created_at: '2026-06-27T10:01:00',
        isOptimistic: true,
        optimisticStatus: 'failed',
      };
      const current = [
        baseMessage({ id: 'msg-1', created_at: '2026-06-27T10:00:00' }),
        failedBubble,
      ];
      const incoming = [
        baseMessage({ id: 'msg-1', created_at: '2026-06-27T10:00:00' }),
        baseMessage({ id: 'msg-2', created_at: '2026-06-27T10:02:00' }),
      ];

      // Even without preserveSendingOptimistic a failed bubble must not be
      // silently dropped by a thread refresh.
      const next = reconcileThreadMessages(current, incoming, {
        conversationId: 'conv-1',
      });

      expect(next.map((item) => item.id)).toEqual(['msg-1', 'msg-2', 'optimistic:client-1']);
      expect(next.at(-1)).toBe(failedBubble);
    });

    it('replaces a failed optimistic bubble when the server echoes it back', () => {
      const failedBubble = {
        id: 'optimistic:client-1',
        client_message_id: 'client-1',
        conversation_id: 'conv-1',
        body: 'sent text',
        created_at: '2026-06-27T10:01:00',
        isOptimistic: true,
        optimisticStatus: 'failed',
        renderKey: 'optimistic:client-1',
      };
      const current = [failedBubble];
      const incoming = [
        baseMessage({
          id: 'msg-9',
          client_message_id: 'client-1',
          body: 'sent text',
          created_at: '2026-06-27T10:01:05',
        }),
      ];

      const next = reconcileThreadMessages(current, incoming, {
        conversationId: 'conv-1',
      });

      expect(next).toHaveLength(1);
      expect(next[0].id).toBe('msg-9');
      // Render key survives the swap so React reuses the same row.
      expect(next[0].renderKey).toBe('optimistic:client-1');
    });

    it('keeps failed optimistic bubbles in replaceWindowButPreserveFreshLocal mode', () => {
      const failedBubble = {
        id: 'optimistic:client-9',
        client_message_id: 'client-9',
        conversation_id: 'conv-1',
        body: 'failed text',
        created_at: '2026-06-27T10:03:00',
        isOptimistic: true,
        optimisticStatus: 'failed',
      };
      const current = [
        baseMessage({ id: 'msg-1', created_at: '2026-06-27T10:00:00' }),
        failedBubble,
      ];
      const incoming = [
        baseMessage({ id: 'msg-1', created_at: '2026-06-27T10:00:00' }),
      ];

      const next = reconcileThreadMessages(current, incoming, {
        conversationId: 'conv-1',
        mode: 'replaceWindowButPreserveFreshLocal',
      });

      expect(next.some((item) => item.id === 'optimistic:client-9')).toBe(true);
    });
  });

  describe('hasPersistedThreadMessageEquivalent', () => {
    it('matches persisted messages by id or client_message_id', () => {
      const messages = [
        baseMessage({ id: 'msg-1', client_message_id: 'client-1' }),
      ];
      expect(hasPersistedThreadMessageEquivalent(
        messages,
        baseMessage({ id: 'msg-1', client_message_id: 'client-1' }),
      )).toBe(true);
      expect(hasPersistedThreadMessageEquivalent(messages, {
        id: 'msg-new',
        client_message_id: 'client-1',
      })).toBe(true);
      expect(hasPersistedThreadMessageEquivalent(messages, baseMessage({ id: 'msg-2' }))).toBe(false);
    });

    it('ignores optimistic entries in the thread list', () => {
      const messages = [
        {
          id: 'optimistic:client-1',
          client_message_id: 'client-1',
          isOptimistic: true,
        },
      ];
      expect(hasPersistedThreadMessageEquivalent(messages, {
        id: 'msg-1',
        client_message_id: 'client-1',
      })).toBe(false);
    });
  });
});
