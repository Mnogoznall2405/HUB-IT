import type { ChatMessage } from '../api/types';
import { findUnreadMentionMessageId } from './chatMentions';

const MY_ID = 42;
const OTHER_ID = 7;

const buildMessage = (id: string, seq: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversation_id: 'conv-1',
  sender_user_id: OTHER_ID,
  conversation_seq: seq,
  ...extra,
});

describe('findUnreadMentionMessageId', () => {
  it('finds an unread mention above the read boundary (newest-first list)', () => {
    // Newest-first list: index 0 = newest message.
    const messages = [
      buildMessage('m5', 5),
      buildMessage('m4', 4, { mentioned_user_ids: [MY_ID] }),
      buildMessage('m3', 3),
      buildMessage('m2', 2, { mentioned_user_ids: [MY_ID] }),
      buildMessage('m1', 1),
    ];
    expect(findUnreadMentionMessageId(messages, MY_ID, 3)).toBe('m4');
  });

  it('returns the oldest unread mention when several are unread', () => {
    const messages = [
      buildMessage('m6', 6, { mentioned_user_ids: [MY_ID] }),
      buildMessage('m5', 5),
      buildMessage('m4', 4, { mentioned_user_ids: [MY_ID] }),
    ];
    expect(findUnreadMentionMessageId(messages, MY_ID, 3)).toBe('m4');
  });

  it('returns null when every loaded mention is already read', () => {
    const messages = [
      buildMessage('m3', 3),
      buildMessage('m2', 2, { mentioned_user_ids: [MY_ID] }),
      buildMessage('m1', 1),
    ];
    expect(findUnreadMentionMessageId(messages, MY_ID, 3)).toBeNull();
  });

  it('skips own, deleted and local-pending messages', () => {
    const messages = [
      buildMessage('m6', 0, {
        mentioned_user_ids: [MY_ID],
        local_status: 'sending',
      }),
      buildMessage('m5', 5, {
        sender_user_id: MY_ID,
        mentioned_user_ids: [MY_ID],
      }),
      buildMessage('m4', 4, {
        is_deleted: true,
        mentioned_user_ids: [MY_ID],
      }),
      buildMessage('m3', 3, { mentioned_user_ids: [MY_ID] }),
    ];
    expect(findUnreadMentionMessageId(messages, MY_ID, 2)).toBe('m3');
  });

  it('returns the oldest mention when nothing is read yet', () => {
    const messages = [
      buildMessage('m3', 3, { mentioned_user_ids: [MY_ID] }),
      buildMessage('m2', 2),
      buildMessage('m1', 1, { mentioned_user_ids: [MY_ID] }),
    ];
    expect(findUnreadMentionMessageId(messages, MY_ID, 0)).toBe('m1');
  });

  it('returns null without a viewer id or messages', () => {
    const messages = [buildMessage('m1', 1, { mentioned_user_ids: [MY_ID] })];
    expect(findUnreadMentionMessageId(messages, 0, 0)).toBeNull();
    expect(findUnreadMentionMessageId([], MY_ID, 0)).toBeNull();
  });
});
