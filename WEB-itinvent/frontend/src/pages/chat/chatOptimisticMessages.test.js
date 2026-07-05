import { describe, expect, it } from 'vitest';

import {
  buildOptimisticFileMessage,
  buildOptimisticTextMessage,
  buildReplyPreview,
  isLikelyOptimisticReplacement,
  revokeOptimisticObjectUrls,
  withStableThreadMessageRenderKey,
} from './chatOptimisticMessages';

describe('chatOptimisticMessages helpers', () => {
  it('buildReplyPreview maps message fields', () => {
    expect(buildReplyPreview({
      id: 'm1',
      kind: 'text',
      body: 'hello',
      sender: { full_name: 'Alice' },
      attachments: [],
    })).toEqual({
      id: 'm1',
      sender_name: 'Alice',
      kind: 'text',
      body: 'hello',
      task_title: undefined,
      attachments_count: 0,
    });
    expect(buildReplyPreview({ id: '', body: 'x' })).toBeNull();
  });

  it('buildReplyPreview treats file attachments as file kind', () => {
    expect(buildReplyPreview({
      id: 'm2',
      attachments: [{ file_name: 'doc.pdf' }],
      sender: { username: 'bob' },
    })?.kind).toBe('file');
  });

  it('isLikelyOptimisticReplacement matches client_message_id', () => {
    const optimistic = {
      id: 'optimistic:c1:1:1',
      isOptimistic: true,
      optimisticStatus: 'sending',
      is_own: true,
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

    expect(isLikelyOptimisticReplacement(optimistic, server)).toBe(true);
    expect(isLikelyOptimisticReplacement(optimistic, { ...server, client_message_id: 'other' })).toBe(false);
  });

  it('buildOptimisticTextMessage creates sending optimistic row', () => {
    const message = buildOptimisticTextMessage({
      conversationId: 'c1',
      body: 'hello',
      user: { id: 7, username: 'alice', full_name: 'Alice' },
      seq: 3,
      now: 1_700_000_000_000,
    });

    expect(message).toMatchObject({
      conversation_id: 'c1',
      body: 'hello',
      isOptimistic: true,
      optimisticStatus: 'sending',
      delivery_status: 'sending',
      sender: { id: 7, username: 'alice', full_name: 'Alice' },
    });
    expect(message?.id).toBe('optimistic:c1:1700000000000:3');
    expect(buildOptimisticTextMessage({ conversationId: '', body: 'x', user: {}, seq: 1 })).toBeNull();
  });

  it('withStableThreadMessageRenderKey preserves render key from existing message', () => {
    const next = withStableThreadMessageRenderKey(
      { id: 'm1', renderKey: 'new-key' },
      { id: 'optimistic:1', renderKey: 'stable-key' },
    );
    expect(next.renderKey).toBe('stable-key');
  });

  it('buildOptimisticFileMessage returns null without files', () => {
    expect(buildOptimisticFileMessage({
      conversationId: 'c1',
      files: [],
      user: { id: 1 },
      seq: 1,
    })).toBeNull();
  });

  it('revokeOptimisticObjectUrls ignores empty urls', () => {
    expect(() => revokeOptimisticObjectUrls([''])).not.toThrow();
  });
});
