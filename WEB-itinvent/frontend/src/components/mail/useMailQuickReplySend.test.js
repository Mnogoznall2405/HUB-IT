import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailQuickReplySend from './useMailQuickReplySend';

describe('useMailQuickReplySend', () => {
  it('does nothing without a selected message', async () => {
    const sendQuickReply = vi.fn();
    const { result } = renderHook(() => useMailQuickReplySend({
      selectedMessage: null,
      mailboxEmails: new Set(['user@example.com']),
      viewMode: 'messages',
      sendQuickReply,
    }));

    await result.current('Hello');

    expect(sendQuickReply).not.toHaveBeenCalled();
  });

  it('sends a message-mode reply using the selected message recipients', async () => {
    const selectedMessage = {
      id: 'msg-1',
      sender_email: 'boss@example.com',
      to_people: [{ display: 'Me', email: 'user@example.com' }],
      cc_people: [],
    };
    const sendQuickReply = vi.fn(async () => undefined);
    const { result } = renderHook(() => useMailQuickReplySend({
      selectedMessage,
      mailboxEmails: new Set(['user@example.com']),
      selectedConversation: {
        participant_people: [
          { display: 'Boss', email: 'boss@example.com' },
          { display: 'Me', email: 'user@example.com' },
          { display: 'Other', email: 'other@example.com' },
        ],
      },
      viewMode: 'messages',
      sendQuickReply,
    }));

    await result.current('Thanks');

    expect(sendQuickReply).toHaveBeenCalledWith(selectedMessage, 'Thanks', { mode: 'reply' });
  });

  it('sends a conversation-mode reply-all from thread participants', async () => {
    const selectedMessage = {
      id: 'msg-2',
      sender_email: 'boss@example.com',
      to_people: [{ display: 'Me', email: 'user@example.com' }],
      cc_people: [],
    };
    const sendQuickReply = vi.fn(async () => undefined);
    const { result } = renderHook(() => useMailQuickReplySend({
      selectedMessage,
      mailboxEmails: new Set(['user@example.com']),
      selectedConversation: {
        participant_people: [
          { display: 'Boss', email: 'boss@example.com' },
          { display: 'Me', email: 'user@example.com' },
          { display: 'Other', email: 'other@example.com' },
        ],
      },
      viewMode: 'conversations',
      sendQuickReply,
    }));

    await result.current('All');

    expect(sendQuickReply).toHaveBeenCalledWith(selectedMessage, 'All', { mode: 'reply_all' });
  });
});
