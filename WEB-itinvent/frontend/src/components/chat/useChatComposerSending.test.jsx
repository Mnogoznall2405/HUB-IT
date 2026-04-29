import React, { useRef, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import { chatSocket } from '../../lib/chatSocket';
import useChatComposerSending from './useChatComposerSending';

vi.mock('../../api/client', () => ({
  chatAPI: {
    sendMessage: vi.fn(),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_WS_ENABLED: true,
}));

vi.mock('../../lib/chatSocket', () => ({
  chatSocket: {
    sendMessage: vi.fn(),
  },
}));

function Harness({ applyOutgoingThreadMessage, setSocketStatus }) {
  const [messageText, setMessageText] = useState('hello');
  const activeConversationIdRef = useRef('conversation-1');
  const draftWriteTimeoutRef = useRef(null);
  const latestMessageTextRef = useRef('hello');
  const socketStatusRef = useRef('connected');

  const { handleComposerSend } = useChatComposerSending({
    activeConversation: { id: 'conversation-1', kind: 'user', title: 'Direct' },
    activeConversationId: 'conversation-1',
    activeConversationIdRef,
    applyOutgoingThreadMessage,
    buildReplyPreview: () => null,
    cancelPendingInitialAnchor: vi.fn(),
    createOptimisticTextMessage: ({ body, bodyFormat }) => ({
      id: 'optimistic-1',
      client_message_id: 'client-1',
      body,
      body_format: bodyFormat,
      isOptimistic: true,
    }),
    draftWriteTimeoutRef,
    flushDraftToStorage: vi.fn(),
    focusComposer: vi.fn(),
    latestMessageTextRef,
    logChatDebug: vi.fn(),
    messageText,
    notifyApiError: vi.fn(),
    readSelectedDatabaseId: () => 'main',
    removeThreadMessage: vi.fn(),
    replyMessage: null,
    setMessageText,
    setOptimisticAiQueuedStatus: vi.fn(),
    setReplyMessage: vi.fn(),
    setSocketStatus,
    socketStatusRef,
    userId: 7,
  });

  return (
    <button type="button" onClick={handleComposerSend}>
      send
    </button>
  );
}

describe('useChatComposerSending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps optimistic message when socket send falls back to HTTP', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const setSocketStatus = vi.fn();
    chatSocket.sendMessage.mockRejectedValueOnce(new Error('socket down'));
    chatAPI.sendMessage.mockResolvedValueOnce({
      id: 'server-1',
      body: 'hello',
      body_format: 'plain',
    });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        setSocketStatus={setSocketStatus}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1));

    expect(chatSocket.sendMessage).toHaveBeenCalledWith('conversation-1', 'hello', expect.objectContaining({
      client_message_id: 'client-1',
      database_id: 'main',
    }));
    expect(setSocketStatus).toHaveBeenCalledWith('disconnected');
    expect(applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      1,
      'conversation-1',
      expect.objectContaining({ id: 'optimistic-1', isOptimistic: true }),
      expect.objectContaining({ scroll: true }),
    );
    expect(applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      2,
      'conversation-1',
      expect.objectContaining({ id: 'server-1' }),
      expect.objectContaining({ replaceId: 'optimistic-1', scroll: false }),
    );
  });
});
