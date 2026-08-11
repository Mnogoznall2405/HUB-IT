import { describe, expect, it } from 'vitest';

import {
  buildOptimisticFileMessage,
  buildOptimisticTextMessage,
  buildReplyPreview,
  isLikelyOptimisticReplacement,
  mergeIncomingThreadMessage,
  resolveServerMessageFromSendAck,
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

  it('mergeIncomingThreadMessage keeps optimistic sender on lean ACK', () => {
    const optimistic = buildOptimisticTextMessage({
      conversationId: 'c1',
      body: 'hello',
      user: { id: 7, username: 'alice', full_name: 'Alice' },
      seq: 1,
      now: 1_700_000_000_000,
      replyPreview: { id: 'r1', sender_name: 'Bob', kind: 'text', body: 'prev' },
    });
    const lean = {
      id: 'server-1',
      conversation_id: 'c1',
      client_message_id: optimistic.client_message_id,
      body: 'hello',
      is_own: true,
      delivery_status: 'sent',
      payload_mode: 'lean',
      sender: { id: 7, username: 'user-7', full_name: null },
      reply_preview: null,
      created_at: '2026-08-03T12:00:00.000Z',
    };

    const merged = mergeIncomingThreadMessage(optimistic, lean);
    expect(merged.id).toBe('server-1');
    expect(merged.isOptimistic).toBe(false);
    expect(merged.sender).toEqual(expect.objectContaining({
      username: 'alice',
      full_name: 'Alice',
    }));
    expect(merged.reply_preview).toEqual(expect.objectContaining({ id: 'r1' }));
    expect(merged.delivery_status).toBe('sent');
  });

  it('mergeIncomingThreadMessage does not downgrade read to sent', () => {
    const existing = {
      id: 'm1',
      conversation_id: 'c1',
      delivery_status: 'read',
      sender: { id: 1, username: 'a', full_name: 'A' },
      body: 'x',
    };
    const incoming = {
      id: 'm1',
      conversation_id: 'c1',
      delivery_status: 'sent',
      sender: { id: 1, username: 'a', full_name: 'A' },
      body: 'x',
    };
    expect(mergeIncomingThreadMessage(existing, incoming).delivery_status).toBe('read');
  });

  it('resolveServerMessageFromSendAck binds lean top-level ACK fields', () => {
    const optimistic = buildOptimisticTextMessage({
      conversationId: 'c1',
      body: 'hi',
      user: { id: 2, username: 'u', full_name: 'U' },
      seq: 1,
      now: 1_700_000_000_100,
    });
    const merged = resolveServerMessageFromSendAck({
      command: 'send_message',
      ok: true,
      message_id: 'srv-9',
      client_message_id: optimistic.client_message_id,
      conversation_id: 'c1',
      seq: 15,
      created_at: '2026-08-03T12:01:00.000Z',
      status: 'sent',
      message: {
        id: 'srv-9',
        payload_mode: 'lean',
        sender: { id: 2, username: 'user-2', full_name: null },
        body: 'hi',
        is_own: true,
      },
    }, { conversationId: 'c1', optimisticMessage: optimistic });

    expect(merged).toEqual(expect.objectContaining({
      id: 'srv-9',
      conversation_seq: 15,
      delivery_status: 'sent',
      sender: expect.objectContaining({ full_name: 'U' }),
    }));
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

  it('marks an optimistic media attachment as a file when requested', () => {
    const message = buildOptimisticFileMessage({
      conversationId: 'c1',
      files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })],
      mediaKinds: ['file'],
      user: { id: 1, username: 'alice' },
      seq: 2,
      now: 1_700_000_000_200,
    });

    expect(message.attachments[0]).toEqual(expect.objectContaining({
      kind: 'file',
      media_kind: 'file',
      file_name: 'photo.jpg',
    }));
    revokeOptimisticObjectUrls(message.optimisticObjectUrls);
  });

  it('revokeOptimisticObjectUrls ignores empty urls', () => {
    expect(() => revokeOptimisticObjectUrls([''])).not.toThrow();
  });
});
