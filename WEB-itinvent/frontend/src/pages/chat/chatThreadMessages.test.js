import { describe, expect, it } from 'vitest';

import {
  areThreadMessagesEquivalent,
  getLatestPersistedThreadMessageId,
  hasPersistedThreadMessageEquivalent,
  isSendingOptimisticThreadMessage,
  reconcileThreadMessages,
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
