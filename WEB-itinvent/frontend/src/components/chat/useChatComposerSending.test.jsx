import React, { useRef, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import { chatSocket } from '../../lib/chatSocket';
import { buildChatDraftKey } from './chatHelpers';
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
    close: vi.fn(),
    isOpen: vi.fn(() => true),
    sendMessage: vi.fn(),
  },
}));

function Harness({
  applyOutgoingThreadMessage,
  setSocketStatus,
  initialText = 'hello',
  latestText = initialText,
}) {
  const [messageText, setMessageText] = useState(initialText);
  const activeConversationIdRef = useRef('conversation-1');
  const draftWriteTimeoutRef = useRef(null);
  const latestMessageTextRef = useRef(latestText);
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

  it('preserves a newer persisted draft when sending fails late', async () => {
    let rejectSend;
    chatSocket.sendMessage.mockImplementationOnce(() => new Promise((_, reject) => { rejectSend = reject; }));
    chatAPI.sendMessage.mockRejectedValueOnce(new Error('503'));
    render(<Harness applyOutgoingThreadMessage={vi.fn()} setSocketStatus={vi.fn()} />);
    fireEvent.click(document.querySelector('button'));
    const key = buildChatDraftKey(7, 'conversation-1');
    window.localStorage.setItem(key, 'newer saved draft');
    rejectSend(new Error('disconnected'));
    await waitFor(() => expect(chatAPI.sendMessage).toHaveBeenCalled());
    expect(window.localStorage.getItem(key)).toBe('newer saved draft');
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
      body_format: 'plain',
    }));
    expect(chatSocket.close).toHaveBeenCalledTimes(1);
    expect(setSocketStatus).toHaveBeenCalledWith('disconnected');
    expect(applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      1,
      'conversation-1',
      expect.objectContaining({ id: 'optimistic-1', isOptimistic: true, body_format: 'plain' }),
      expect.objectContaining({ scroll: true }),
    );
    expect(applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      2,
      'conversation-1',
      expect.objectContaining({ id: 'server-1' }),
      expect.objectContaining({ replaceId: 'optimistic-1', scroll: false }),
    );
  });

  it('sends Telegram-like markdown-looking composer text as plain text', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const setSocketStatus = vi.fn();
    const text = '1. купить картридж\n2. закрыть заявку\n# не заголовок';
    chatSocket.sendMessage.mockResolvedValueOnce({
      message: {
        id: 'server-plain',
        body: text,
        body_format: 'plain',
      },
    });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        setSocketStatus={setSocketStatus}
        initialText={text}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatSocket.sendMessage).toHaveBeenCalledTimes(1));

    expect(chatSocket.sendMessage).toHaveBeenCalledWith('conversation-1', text, expect.objectContaining({
      body_format: 'plain',
    }));
    expect(applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      1,
      'conversation-1',
      expect.objectContaining({ body: text, body_format: 'plain' }),
      expect.objectContaining({ scroll: true }),
    );
    expect(chatAPI.sendMessage).not.toHaveBeenCalled();
  });

  it('sends the latest composer ref value while the parent render is deferred', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const setSocketStatus = vi.fn();
    chatSocket.sendMessage.mockResolvedValueOnce({
      message: {
        id: 'server-latest',
        body: 'fresh text',
        body_format: 'plain',
      },
    });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        setSocketStatus={setSocketStatus}
        initialText="stale text"
        latestText="fresh text"
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatSocket.sendMessage).toHaveBeenCalledTimes(1));
    expect(chatSocket.sendMessage).toHaveBeenCalledWith(
      'conversation-1',
      'fresh text',
      expect.objectContaining({ body_format: 'plain' }),
    );
  });
});
