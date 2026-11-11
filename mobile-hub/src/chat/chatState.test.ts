import type { ChatMessage } from '../api/types';
import {
  applyConversationEnvelope,
  applyReactionEnvelope,
  applyReadReceiptDelta,
  buildChatThreadRowDecorations,
  clearConversationUnread,
  findLatestIncomingMessage,
  getMessageGroupPosition,
  getUnreadBoundaryMessageId,
  mergeMessages,
  messageFromEnvelope,
  resolveChatMessageIsOwn,
  shouldShowMessageDateSeparator,
  toggleReactionOptimistic,
} from './chatState';

describe('chat state', () => {
  it('preserves unchanged messages and treats a repeated delivery as a no-op', () => {
    const current = mergeMessages([], [
      { id: 'm2', conversation_id: 'c1', sender_user_id: 2, conversation_seq: 2 },
      { id: 'm1', conversation_id: 'c1', sender_user_id: 1, conversation_seq: 1 },
    ], 1);
    const updated = mergeMessages(current, { ...current[0], body_text: 'edited' }, 1);
    expect(updated[0]).not.toBe(current[0]);
    expect(updated[1]).toBe(current[1]);
    expect(mergeMessages(updated, { ...updated[0] }, 1)).toBe(updated);
  });

  it('preserves ownership when a partial update omits sender identity', () => {
    const current = mergeMessages([], {
      id: 'm1', conversation_id: 'c1', sender_user_id: 1, body_text: 'old',
    }, 1);
    expect(mergeMessages(current, {
      id: 'm1', conversation_id: 'c1', body_text: 'edited',
    } as ChatMessage, 1)[0]).toMatchObject({ sender_user_id: 1, is_own: true, body_text: 'edited' });
  });

  it('recomputes ownership when the viewer changes without mutating source messages', () => {
    const current = mergeMessages([], {
      id: 'm1', conversation_id: 'c1', sender_user_id: 1,
    }, 1);
    const updated = mergeMessages(current, [], 2);
    expect(updated[0].is_own).toBe(false);
    expect(current[0].is_own).toBe(true);
  });

  it('formats historical date labels once per day and refreshes relative labels on the next day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T12:00:00'));
    const format = jest.spyOn(Date.prototype, 'toLocaleDateString');
    try {
      const messages = Array.from({ length: 100 }, (_, index) => ({
        id: `m${index}`, conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T12:00:00',
      }));
      const rows = buildChatThreadRowDecorations(messages);
      expect(format).toHaveBeenCalledTimes(1);
      expect(new Set(rows.map((row) => row.dateLabel)).size).toBe(1);
      const recent = [{ id: 'today', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-09-14T12:00:00' }];
      const todayLabel = buildChatThreadRowDecorations(recent)[0].dateLabel;
      jest.setSystemTime(new Date('2026-09-15T12:00:00'));
      expect(buildChatThreadRowDecorations(recent)[0].dateLabel).not.toBe(todayLabel);
    } finally {
      format.mockRestore();
      jest.useRealTimers();
    }
  });

  it('deduplicates messages and orders newest first for the inverted list', () => {
    const result = mergeMessages(
      [{ id: 'm1', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:00:00Z' }],
      [
        { id: 'm1', conversation_id: 'c1', sender_user_id: 2, body_text: 'updated', created_at: '2026-01-01T10:00:00Z' },
        { id: 'm2', conversation_id: 'c1', sender_user_id: 1, created_at: '2026-01-01T10:01:00Z' },
      ],
      1,
    );
    expect(result.map((item) => item.id)).toEqual(['m2', 'm1']);
    expect(result[1].body_text).toBe('updated');
    expect(result[0].is_own).toBe(true);
  });

  it('updates an existing conversation locally for a new message', () => {
    const result = applyConversationEnvelope(
      [{ id: 'c1', title: 'Диалог', unread_count: 0 }],
      { payload: { conversation_id: 'c1', message: {
        id: 'm1', conversation_id: 'c1', sender_user_id: 2,
        body_text: 'Привет', created_at: '2026-01-01T10:00:00Z',
      } } },
      1,
    );
    expect(result.handled).toBe(true);
    expect(result.items[0]).toMatchObject({
      id: 'c1', last_message_preview: 'Привет', unread_count: 1,
    });
  });

  it('keeps unread at zero when the conversation is currently open', () => {
    const result = applyConversationEnvelope(
      [{ id: 'c1', title: 'Диалог', unread_count: 2 }],
      { payload: { conversation_id: 'c1', message: {
        id: 'm2', conversation_id: 'c1', sender_user_id: 2,
        body_text: 'Ещё одно', created_at: '2026-01-01T10:01:00Z', conversation_seq: 2,
      } } },
      1,
      'c1',
    );
    expect(result.items[0]).toMatchObject({
      last_message_preview: 'Ещё одно',
      unread_count: 0,
    });
  });

  it('clears unread for a conversation without dropping the preview', () => {
    expect(clearConversationUnread(
      [
        { id: 'c1', title: 'Диалог', unread_count: 3, last_message_preview: 'Привет' },
        { id: 'c2', title: 'Другой', unread_count: 1 },
      ],
      'c1',
    )).toEqual([
      { id: 'c1', title: 'Диалог', unread_count: 0, last_message_preview: 'Привет' },
      { id: 'c2', title: 'Другой', unread_count: 1 },
    ]);
  });

  it('normalizes created and deleted message envelope shapes', () => {
    expect(messageFromEnvelope({ payload: { conversation_id: 'c1', message: {
      id: 'm1', sender: { id: 2, username: 'ivan' }, body: 'Привет',
    } } })).toMatchObject({ id: 'm1', conversation_id: 'c1', body_text: 'Привет' });

    expect(messageFromEnvelope({ payload: {
      id: 'm1', conversation_id: 'c1', sender_user_id: 2,
      body_text: 'Сообщение удалено', is_deleted: true,
    } })).toMatchObject({ id: 'm1', conversation_id: 'c1', is_deleted: true });
  });

  it('keeps an outgoing attachment on the own side after a room echo with is_own false', () => {
    const result = mergeMessages(
      [{
        id: 'file-1',
        conversation_id: 'c1',
        sender_user_id: 1,
        is_own: true,
        attachments: [{ id: 'a1', file_name: 'photo.jpg', kind: 'image' }],
        created_at: '2026-01-01T10:02:00Z',
      }],
      {
        id: 'file-1',
        conversation_id: 'c1',
        sender_user_id: 1,
        sender: { id: 1, username: 'me' },
        is_own: false,
        attachments: [{ id: 'a1', file_name: 'photo.jpg', kind: 'image' }],
        created_at: '2026-01-01T10:02:00Z',
      },
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0].is_own).toBe(true);
  });

  it('still treats a peer file as incoming', () => {
    const result = mergeMessages(
      [],
      {
        id: 'file-2',
        conversation_id: 'c1',
        sender_user_id: 2,
        is_own: false,
        attachments: [{ id: 'a2', file_name: 'scan.pdf' }],
      },
      1,
    );
    expect(result[0].is_own).toBe(false);
  });

  it('resolves ownership from sender id even when user id is a string', () => {
    expect(resolveChatMessageIsOwn({
      sender_user_id: 7,
      is_own: false,
    }, '7')).toBe(true);
    expect(resolveChatMessageIsOwn({
      sender_user_id: 7,
      sender: { id: 7, username: 'me' },
      is_own: false,
    }, 7)).toBe(true);
    expect(resolveChatMessageIsOwn({
      sender_user_id: 3,
      is_own: true,
    }, 7)).toBe(false);
  });

  it('marks the latest visible incoming message even when an own message is newer', () => {
    const messages = [
      { id: 'own-2', conversation_id: 'c1', sender_user_id: 7, conversation_seq: 3 },
      { id: 'peer-1', conversation_id: 'c1', sender_user_id: 8, conversation_seq: 2 },
      { id: 'own-1', conversation_id: 'c1', sender_user_id: 7, conversation_seq: 1 },
    ];
    expect(findLatestIncomingMessage(messages, 7)?.id).toBe('peer-1');
  });

  it('reconciles an optimistic message with the authoritative client message id', () => {
    const result = mergeMessages(
      [{
        id: 'pending:mobile-1', conversation_id: 'c1', sender_user_id: 1,
        client_message_id: 'mobile-1', body_text: 'Ответ', local_status: 'sending',
      }],
      {
        id: 'm2', conversation_id: 'c1', sender_user_id: 1,
        client_message_id: 'mobile-1', body_text: 'Ответ', conversation_seq: 2,
      },
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'm2', client_message_id: 'mobile-1' });
  });

  it('keeps a pending outgoing message at the visual bottom despite phone clock skew', () => {
    const result = mergeMessages(
      [{
        id: 'm2', conversation_id: 'c1', sender_user_id: 2,
        body_text: 'peer', conversation_seq: 2, created_at: '2026-08-24T12:00:00Z',
      }],
      {
        id: 'pending:mobile-skewed', conversation_id: 'c1', sender_user_id: 1,
        client_message_id: 'mobile-skewed', body_text: 'mine', local_status: 'sending',
        created_at: '2026-08-23T12:00:00Z',
      },
      1,
    );
    expect(result.map((item) => item.id)).toEqual(['pending:mobile-skewed', 'm2']);
  });

  it('does not increment unread twice for a duplicate realtime delivery', () => {
    const envelope = { payload: {
      id: 'm2', conversation_id: 'c1', conversation_seq: 2,
      sender: { id: 2, username: 'ivan' }, body: 'Привет', created_at: '2026-01-01T10:01:00Z',
    } };
    const first = applyConversationEnvelope(
      [{ id: 'c1', title: 'Диалог', unread_count: 0, last_message_seq: 1 }],
      envelope,
      1,
    );
    const duplicate = applyConversationEnvelope(first.items, envelope, 1);
    expect(duplicate.items[0].unread_count).toBe(1);
    expect(duplicate.items[0].last_message_seq).toBe(2);
  });

  it('applies a reaction-only event without reloading the thread', () => {
    const result = applyReactionEnvelope(
      [{ id: 'm1', conversation_id: 'c1', sender_user_id: 2 }],
      { payload: {
        conversation_id: 'c1', message_id: 'm1',
        reactions: [{ emoji: '🔥', count: 3, user_ids: [1, 2, 3] }],
      } },
    );
    expect(result.handled).toBe(true);
    expect(result.items[0].reactions).toEqual([
      expect.objectContaining({ emoji: '🔥', count: 3, user_ids: [1, 2, 3] }),
    ]);
  });

  it('keeps reactions and attachments when a sparse update omits them', () => {
    const loaded = mergeMessages([], {
      id: 'm1', conversation_id: 'c1', sender_user_id: 2, body_text: 'Фото',
      sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
      attachments: [{ id: 'a1', kind: 'image', file_name: 'photo.jpg' }],
      reactions: [{ emoji: '🔥', count: 2 }],
      reply_preview: { id: 'm0', sender_name: 'Мария Иванова', body: 'Исходное' },
    } as ChatMessage, 1);
    // A lean chat.message.updated envelope normalizes to a sparse patch.
    const sparse = messageFromEnvelope({ payload: {
      id: 'm1', conversation_id: 'c1', conversation_seq: 4, edited_at: '2026-01-02T09:00:00Z',
    } });
    expect(sparse?.reactions).toBeUndefined();
    const merged = mergeMessages(loaded, sparse!, 1);
    expect(merged[0]).toMatchObject({
      reactions: [{ emoji: '🔥', count: 2 }],
      attachments: [{ id: 'a1', kind: 'image', file_name: 'photo.jpg' }],
      sender: { id: 2, username: 'maria' },
      reply_preview: { id: 'm0' },
      edited_at: '2026-01-02T09:00:00Z',
      conversation_seq: 4,
    });
  });

  it('marks own messages read from the receipt target down the thread (M1)', () => {
    // Newest-first thread: own-new (idx0), own-target (idx1), own-older (idx2), peer (idx3).
    const current = [
      { id: 'own-new', conversation_id: 'c1', sender_user_id: 1, delivery_status: 'sent' as const },
      { id: 'own-target', conversation_id: 'c1', sender_user_id: 1, delivery_status: 'sent' as const },
      { id: 'own-older', conversation_id: 'c1', sender_user_id: 1, delivery_status: 'sent' as const },
      { id: 'peer', conversation_id: 'c1', sender_user_id: 2 },
    ] as ChatMessage[];
    const items = applyReadReceiptDelta(current, {
      conversation_id: 'c1', message_id: 'own-target', delivery_status: 'read', read_by_count: 1,
    }, 1);
    expect(items[0].delivery_status).toBe('sent');
    expect(items[1]).toMatchObject({ delivery_status: 'read', read_by_count: 1 });
    expect(items[2]).toMatchObject({ delivery_status: 'read', read_by_count: 1 });
    expect(items[3].delivery_status).toBeUndefined();
  });

  it('patches only the target message for a non-read delta and never lowers read_by_count (M1)', () => {
    const current = [
      { id: 'own-1', conversation_id: 'c1', sender_user_id: 1, delivery_status: 'read' as const, read_by_count: 2 },
      { id: 'own-2', conversation_id: 'c1', sender_user_id: 1, delivery_status: 'sent' as const, read_by_count: 0 },
    ] as ChatMessage[];
    const sent = applyReadReceiptDelta(current, {
      message_id: 'own-2', delivery_status: 'sent', read_by_count: 0,
    }, 1);
    expect(sent[0]).toBe(current[0]);
    expect(sent[1]).toMatchObject({ delivery_status: 'sent', read_by_count: 0 });
    const shrunk = applyReadReceiptDelta(current, {
      message_id: 'own-1', delivery_status: 'read', read_by_count: 1,
    }, 1);
    expect(shrunk[0].read_by_count).toBe(2);
  });

  it('ignores read receipts for unknown or missing message ids (M1)', () => {
    const current = [
      { id: 'own-1', conversation_id: 'c1', sender_user_id: 1, delivery_status: 'sent' as const },
    ] as ChatMessage[];
    expect(applyReadReceiptDelta(current, { message_id: 'absent', delivery_status: 'read' }, 1)).toBe(current);
    expect(applyReadReceiptDelta(current, {}, 1)).toBe(current);
    expect(applyReadReceiptDelta(current, null, 1)).toBe(current);
  });

  it('optimistically adds and removes the current user reaction', () => {
    const added = toggleReactionOptimistic([], '👍', 1);
    expect(added).toEqual([{
      emoji: '👍', count: 1, user_ids: [1], reacted_by_me: true,
    }]);

    const removed = toggleReactionOptimistic(added, '👍', 1);
    expect(removed).toEqual([]);
  });

  it('groups adjacent messages from the same sender within five minutes', () => {
    const messages = [
      { id: 'm3', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:02:00Z' },
      { id: 'm2', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:01:00Z' },
      { id: 'm1', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:00:00Z' },
    ];
    expect(getMessageGroupPosition(messages, 0)).toBe('last');
    expect(getMessageGroupPosition(messages, 1)).toBe('middle');
    expect(getMessageGroupPosition(messages, 2)).toBe('first');
  });

  it('does not group deleted messages or messages from another sender', () => {
    const messages = [
      { id: 'm3', conversation_id: 'c1', sender_user_id: 3, created_at: '2026-01-01T10:02:00Z' },
      { id: 'm2', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:01:00Z', is_deleted: true },
      { id: 'm1', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:00:00Z' },
    ];
    expect(messages.map((_, index) => getMessageGroupPosition(messages, index))).toEqual([
      'single', 'single', 'single',
    ]);
  });

  it('places date and unread separators at stable message boundaries', () => {
    const messages = [
      { id: 'm3', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-02T09:00:00Z' },
      { id: 'm2', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:01:00Z' },
      { id: 'm1', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:00:00Z' },
    ];
    expect(shouldShowMessageDateSeparator(messages, 0)).toBe(true);
    expect(shouldShowMessageDateSeparator(messages, 1)).toBe(false);
    expect(shouldShowMessageDateSeparator(messages, 2)).toBe(true);
    expect(getUnreadBoundaryMessageId(messages, 'm1')).toBe('m2');
    expect(getUnreadBoundaryMessageId(messages, 'm3')).toBeNull();
  });

  it('precomputes date and group decorations for inverted thread rows', () => {
    const messages = [
      { id: 'm3', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-02T09:00:00Z' },
      { id: 'm2', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:01:00Z' },
      { id: 'm1', conversation_id: 'c1', sender_user_id: 2, created_at: '2026-01-01T10:00:00Z' },
    ];
    expect(buildChatThreadRowDecorations(messages, getUnreadBoundaryMessageId(messages, 'm1')).map((item) => ({
      showDate: item.showDate,
      groupPosition: item.groupPosition,
      unreadBoundary: item.unreadBoundary,
    }))).toEqual([
      { showDate: true, groupPosition: 'single', unreadBoundary: false },
      { showDate: false, groupPosition: 'last', unreadBoundary: true },
      { showDate: true, groupPosition: 'first', unreadBoundary: false },
    ]);
  });
});
