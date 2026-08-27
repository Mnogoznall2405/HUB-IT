import {
  applyConversationEnvelope,
  applyReactionEnvelope,
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
