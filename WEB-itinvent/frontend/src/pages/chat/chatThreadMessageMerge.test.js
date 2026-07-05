import { describe, expect, it } from 'vitest';

import {
  buildOptimisticFileMessage,
  isLikelyOptimisticReplacement,
  revokeOptimisticObjectUrls,
} from './chatOptimisticMessages';
import {
  removeThreadMessageFromList,
  resolveThreadMessageMerge,
  upsertThreadMessagesInList,
} from './chatThreadMessageMerge';

describe('chatThreadMessageMerge helpers', () => {
  it('upsertThreadMessagesInList appends message for active conversation', () => {
    const current = [{ id: 'm1', conversation_id: 'c1', created_at: '2026-01-01T00:00:00.000Z' }];
    const next = upsertThreadMessagesInList(current, [{
      id: 'm2',
      conversation_id: 'c1',
      created_at: '2026-01-01T00:00:01.000Z',
    }], { activeConversationId: 'c1' });

    expect(next).toHaveLength(2);
    expect(next.map((item) => item.id)).toEqual(['m1', 'm2']);
  });

  it('upsertThreadMessagesInList replaces optimistic row by replace map', () => {
    const current = [
      { id: 'optimistic:c1:1', conversation_id: 'c1', created_at: '2026-01-01T00:00:00.000Z', renderKey: 'rk1' },
    ];
    const serverMessage = {
      id: 'm1',
      conversation_id: 'c1',
      created_at: '2026-01-01T00:00:01.000Z',
      body: 'hi',
    };
    const next = upsertThreadMessagesInList(current, [serverMessage], {
      activeConversationId: 'c1',
      replaceByMessageId: new Map([['m1', 'optimistic:c1:1']]),
      withStableMessageRenderKey: (message, existing) => ({
        ...message,
        renderKey: existing?.renderKey || message.renderKey,
      }),
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('m1');
    expect(next[0]?.renderKey).toBe('rk1');
  });

  it('upsertThreadMessagesInList ignores other conversations', () => {
    const current = [{ id: 'm1', conversation_id: 'c1', created_at: '2026-01-01T00:00:00.000Z' }];
    const next = upsertThreadMessagesInList(current, [{
      id: 'm2',
      conversation_id: 'c2',
      created_at: '2026-01-01T00:00:01.000Z',
    }], { activeConversationId: 'c1' });

    expect(next).toBe(current);
  });

  it('resolveThreadMessageMerge picks optimistic replacement', () => {
    const optimistic = {
      id: 'optimistic:c1:1',
      renderKey: 'optimistic:c1:1',
      isOptimistic: true,
      optimisticStatus: 'sending',
      conversation_id: 'c1',
      kind: 'text',
      client_message_id: 'client-1',
      body: 'hi',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const server = {
      id: 'm1',
      is_own: true,
      conversation_id: 'c1',
      kind: 'text',
      client_message_id: 'client-1',
      body: 'hi',
      created_at: '2026-01-01T00:00:01.000Z',
    };

    const resolved = resolveThreadMessageMerge(server, [optimistic], {
      isLikelyOptimisticReplacement,
      withStableMessageRenderKey: (message, existing) => ({
        ...message,
        renderKey: existing?.renderKey || message.id,
      }),
    });

    expect(resolved?.replaceId).toBe('optimistic:c1:1');
    expect(resolved?.message?.id).toBe('m1');
    expect(resolved?.message?.renderKey).toBe('optimistic:c1:1');
  });

  it('removeThreadMessageFromList drops target id', () => {
    const current = [
      { id: 'm1', conversation_id: 'c1' },
      { id: 'm2', conversation_id: 'c1' },
    ];
    expect(removeThreadMessageFromList(current, 'm1').map((item) => item.id)).toEqual(['m2']);
  });
});

describe('chatOptimisticMessages file helpers', () => {
  it('buildOptimisticFileMessage creates file optimistic row', () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const message = buildOptimisticFileMessage({
      conversationId: 'c1',
      files: [file],
      body: 'caption',
      user: { id: 3, username: 'bob', full_name: 'Bob' },
      seq: 2,
      now: 1_700_000_000_000,
    });

    expect(message).toMatchObject({
      conversation_id: 'c1',
      kind: 'file',
      body: 'caption',
      isOptimistic: true,
      optimisticStatus: 'sending',
      attachments: [expect.objectContaining({ file_name: 'note.txt' })],
    });
    expect(message?.id).toBe('optimistic:c1:file:1700000000000:2');
  });

  it('revokeOptimisticObjectUrls ignores invalid entries', () => {
    expect(() => revokeOptimisticObjectUrls(['', null, 'blob:missing'])).not.toThrow();
  });
});
