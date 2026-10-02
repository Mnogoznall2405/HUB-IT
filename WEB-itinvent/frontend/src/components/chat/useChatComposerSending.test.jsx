import React, { useRef, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import { chatStickersAPI } from '../../api/chatStickers';
import { chatSocket } from '../../lib/chatSocket';
import { buildChatDraftKey } from './chatHelpers';
import useChatComposerSending from './useChatComposerSending';

vi.mock('../../api/client', () => ({
  chatAPI: {
    sendMessage: vi.fn(),
  },
}));

vi.mock('../../api/chatStickers', () => ({
  chatStickersAPI: {
    sendSticker: vi.fn(),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_WS_ENABLED: true,
}));

vi.mock('../../lib/chatSocket', () => ({
  chatSocket: {
    close: vi.fn(),
    isOpen: vi.fn(() => true),
    reconnectNow: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

function Harness({
  apiRef,
  applyOutgoingThreadMessage,
  ensureLatestThreadWindow,
  failedThreadMessagesRef,
  notifyApiError = vi.fn(),
  removeThreadMessage = vi.fn(),
  initialText = 'hello',
  latestText = initialText,
}) {
  const [messageText, setMessageText] = useState(initialText);
  const activeConversationIdRef = useRef('conversation-1');
  const draftWriteTimeoutRef = useRef(null);
  const latestMessageTextRef = useRef(latestText);
  const socketStatusRef = useRef('connected');

  const hookApi = useChatComposerSending({
    activeConversation: { id: 'conversation-1', kind: 'user', title: 'Direct' },
    activeConversationId: 'conversation-1',
    activeConversationIdRef,
    applyOutgoingThreadMessage,
    ensureLatestThreadWindow,
    buildReplyPreview: () => null,
    cancelPendingInitialAnchor: vi.fn(),
    createOptimisticTextMessage: ({ body, bodyFormat }) => ({
      id: 'optimistic-1',
      client_message_id: 'client-1',
      conversation_id: 'conversation-1',
      body,
      body_format: bodyFormat,
      isOptimistic: true,
      optimisticStatus: 'sending',
    }),
    draftWriteTimeoutRef,
    failedThreadMessagesRef,
    flushDraftToStorage: vi.fn(),
    focusComposer: vi.fn(),
    latestMessageTextRef,
    logChatDebug: vi.fn(),
    messageText,
    notifyApiError,
    readSelectedDatabaseId: () => 'main',
    removeThreadMessage,
    replyMessage: null,
    setMessageText,
    setOptimisticAiQueuedStatus: vi.fn(),
    setReplyMessage: vi.fn(),
    setSocketStatus: vi.fn(),
    socketStatusRef,
    userId: 7,
  });
  if (apiRef) apiRef.current = hookApi;

  return (
    <button type="button" onClick={hookApi.handleComposerSend}>
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
    render(<Harness applyOutgoingThreadMessage={vi.fn()} />);
    fireEvent.click(document.querySelector('button'));
    // The send now awaits the newer-window drain first — wait until the socket
    // attempt is in flight before rejecting it.
    await waitFor(() => expect(chatSocket.sendMessage).toHaveBeenCalled());
    const key = buildChatDraftKey(7, 'conversation-1');
    window.localStorage.setItem(key, 'newer saved draft');
    rejectSend(new Error('disconnected'));
    await waitFor(() => expect(chatAPI.sendMessage).toHaveBeenCalled());
    expect(window.localStorage.getItem(key)).toBe('newer saved draft');
  });

  it('keeps optimistic message when socket send falls back to HTTP', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    chatSocket.sendMessage.mockRejectedValueOnce(new Error('socket down'));
    chatAPI.sendMessage.mockResolvedValueOnce({
      id: 'server-1',
      body: 'hello',
      body_format: 'plain',
    });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1));

    expect(chatSocket.sendMessage).toHaveBeenCalledWith('conversation-1', 'hello', expect.objectContaining({
      client_message_id: 'client-1',
      database_id: 'main',
      body_format: 'plain',
    }));
    expect(chatSocket.reconnectNow).toHaveBeenCalledTimes(1);
    expect(chatSocket.close).not.toHaveBeenCalled();
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

  it('R3: rate_limited falls back to HTTP with the same client_message_id', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    chatSocket.sendMessage.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), { chatErrorCode: 'rate_limited' }),
    );
    chatAPI.sendMessage.mockResolvedValueOnce({
      id: 'server-2',
      body: 'hello',
      body_format: 'plain',
    });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1));
    expect(chatAPI.sendMessage).toHaveBeenCalledWith('conversation-1', 'hello', expect.objectContaining({
      client_message_id: 'client-1',
    }));
    expect(chatSocket.reconnectNow).not.toHaveBeenCalled();
    expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ id: 'server-2' }),
      expect.objectContaining({ replaceId: 'optimistic-1', scroll: false }),
    );
  });

  it('R3: command_failed falls back to HTTP with the same client_message_id', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    chatSocket.sendMessage.mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), { chatErrorCode: 'command_failed' }),
    );
    chatAPI.sendMessage.mockResolvedValueOnce({
      id: 'server-3',
      body: 'hello',
      body_format: 'plain',
    });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1));
    expect(chatAPI.sendMessage).toHaveBeenCalledWith('conversation-1', 'hello', expect.objectContaining({
      client_message_id: 'client-1',
    }));
    expect(chatSocket.reconnectNow).not.toHaveBeenCalled();
    expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ id: 'server-3' }),
      expect.objectContaining({ replaceId: 'optimistic-1', scroll: false }),
    );
  });

  it.each(['validation_error', 'forbidden'])(
    'R3: %s skips the HTTP fallback and marks the bubble failed',
    async (chatErrorCode) => {
      const applyOutgoingThreadMessage = vi.fn();
      const notifyApiError = vi.fn();
      chatSocket.sendMessage.mockRejectedValueOnce(
        Object.assign(new Error(chatErrorCode), { chatErrorCode }),
      );

      render(
        <Harness
          applyOutgoingThreadMessage={applyOutgoingThreadMessage}
          notifyApiError={notifyApiError}
        />,
      );

      fireEvent.click(document.querySelector('button'));

      await waitFor(() => expect(notifyApiError).toHaveBeenCalledTimes(1));

      expect(chatAPI.sendMessage).not.toHaveBeenCalled();
      expect(chatSocket.reconnectNow).not.toHaveBeenCalled();
      expect(chatSocket.close).not.toHaveBeenCalled();
      expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
        'conversation-1',
        expect.objectContaining({ id: 'optimistic-1', optimisticStatus: 'failed' }),
        expect.objectContaining({ scroll: false }),
      );
    },
  );

  it('R4: failures land in the shared failedThreadMessagesRef when provided', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const failedThreadMessagesRef = { current: new Map() };
    chatSocket.sendMessage.mockRejectedValueOnce(new Error('socket down'));
    chatAPI.sendMessage.mockRejectedValueOnce(new Error('503'));

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        failedThreadMessagesRef={failedThreadMessagesRef}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ optimisticStatus: 'failed' }),
      expect.objectContaining({ scroll: false }),
    ));

    const entry = failedThreadMessagesRef.current.get('conversation-1')?.get('optimistic-1');
    expect(entry).toMatchObject({
      conversationId: 'conversation-1',
      clientMessageId: 'client-1',
    });
    expect(entry?.message?.optimisticStatus).toBe('failed');
  });

  it('keeps the failed optimistic bubble and retries with the same client_message_id', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const apiRef = { current: null };
    chatSocket.sendMessage
      .mockRejectedValueOnce(new Error('socket down'))
      .mockResolvedValueOnce({
        message: { id: 'server-9', body: 'hello', body_format: 'plain' },
      });
    chatAPI.sendMessage.mockRejectedValueOnce(new Error('503'));

    render(
      <Harness
        apiRef={apiRef}
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ id: 'optimistic-1', optimisticStatus: 'failed' }),
      expect.objectContaining({ scroll: false }),
    ));

    const retried = await apiRef.current.retryFailedMessage('optimistic-1');
    expect(retried).toBe(true);
    expect(chatSocket.sendMessage).toHaveBeenCalledTimes(2);
    expect(chatSocket.sendMessage).toHaveBeenNthCalledWith(2, 'conversation-1', 'hello', expect.objectContaining({
      client_message_id: 'client-1',
    }));
    expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ id: 'server-9' }),
      expect.objectContaining({ replaceId: 'optimistic-1', scroll: false }),
    );
  });

  it('retries a failed sticker via sendSticker with the same client_message_id', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const apiRef = { current: null };
    chatStickersAPI.sendSticker.mockResolvedValueOnce({ id: 'server-sticker-1' });

    render(<Harness apiRef={apiRef} applyOutgoingThreadMessage={applyOutgoingThreadMessage} />);

    const optimisticSticker = {
      id: 'optimistic-sticker-1',
      client_message_id: 'client-sticker-1',
      conversation_id: 'conversation-1',
      kind: 'file',
      attachments: [{ kind: 'sticker', media_kind: 'sticker' }],
      isOptimistic: true,
      optimisticStatus: 'sending',
    };
    apiRef.current.registerFailedOutgoingMessage('conversation-1', optimisticSticker, {
      replyToMessageId: 'reply-9',
      stickerResend: { stickerId: 'sticker-1' },
    });

    const retried = await apiRef.current.retryFailedMessage('optimistic-sticker-1');
    expect(retried).toBe(true);
    expect(chatStickersAPI.sendSticker).toHaveBeenCalledTimes(1);
    expect(chatStickersAPI.sendSticker).toHaveBeenCalledWith(
      'conversation-1',
      'sticker-1',
      {
        client_message_id: 'client-sticker-1',
        reply_to_message_id: 'reply-9',
      },
    );
    expect(chatAPI.sendMessage).not.toHaveBeenCalled();
    expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ id: 'server-sticker-1' }),
      expect.objectContaining({ replaceId: 'optimistic-sticker-1', scroll: false }),
    );
  });

  it('discardFailedMessage removes the failed bubble', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const removeThreadMessage = vi.fn();
    const apiRef = { current: null };
    chatSocket.sendMessage.mockRejectedValueOnce(new Error('socket down'));
    chatAPI.sendMessage.mockRejectedValueOnce(new Error('503'));

    render(
      <Harness
        apiRef={apiRef}
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        removeThreadMessage={removeThreadMessage}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ optimisticStatus: 'failed' }),
      expect.objectContaining({ scroll: false }),
    ));

    expect(apiRef.current.discardFailedMessage('optimistic-1')).toBe(true);
    expect(removeThreadMessage).toHaveBeenCalledWith('optimistic-1');
    expect(apiRef.current.discardFailedMessage('optimistic-1')).toBe(false);
  });

  it('sends Telegram-like markdown-looking composer text as plain text', async () => {
    const applyOutgoingThreadMessage = vi.fn();
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

  it('R20: drains the newer window before the optimistic bubble goes in', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const callOrder = [];
    const ensureLatestThreadWindow = vi.fn(async () => {
      callOrder.push('drain');
    });
    chatSocket.sendMessage.mockImplementationOnce(async () => {
      callOrder.push('socketSend');
      return { message: { id: 'server-drain', body: 'hello', body_format: 'plain' } };
    });

    render(
      <Harness
        applyOutgoingThreadMessage={(...args) => {
          callOrder.push('optimisticApply');
          applyOutgoingThreadMessage(...args);
        }}
        ensureLatestThreadWindow={ensureLatestThreadWindow}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(callOrder.slice(0, 3)).toEqual(['drain', 'optimisticApply', 'socketSend']));
    expect(ensureLatestThreadWindow).toHaveBeenCalledTimes(1);
  });

  it('R20: retry of a failed message drains the newer window first', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const apiRef = { current: null };
    const callOrder = [];
    const ensureLatestThreadWindow = vi.fn(async () => {
      callOrder.push('drain');
    });
    chatSocket.sendMessage
      .mockRejectedValueOnce(new Error('socket down'))
      .mockImplementationOnce(async () => {
        callOrder.push('socketSend');
        return { message: { id: 'server-retry', body: 'hello', body_format: 'plain' } };
      });
    chatAPI.sendMessage.mockRejectedValueOnce(new Error('503'));

    render(
      <Harness
        apiRef={apiRef}
        applyOutgoingThreadMessage={(...args) => {
          if (!callOrder.includes('optimisticApply')) callOrder.push('optimisticApply');
          applyOutgoingThreadMessage(...args);
        }}
        ensureLatestThreadWindow={ensureLatestThreadWindow}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(applyOutgoingThreadMessage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ optimisticStatus: 'failed' }),
      expect.objectContaining({ scroll: false }),
    ));
    expect(callOrder.slice(0, 2)).toEqual(['drain', 'optimisticApply']);
    expect(ensureLatestThreadWindow).toHaveBeenCalledTimes(1);

    const retried = await apiRef.current.retryFailedMessage('optimistic-1');
    expect(retried).toBe(true);
    expect(callOrder.slice(-2)).toEqual(['drain', 'socketSend']);
    expect(ensureLatestThreadWindow).toHaveBeenCalledTimes(2);
  });

  it('sends the latest composer ref value while the parent render is deferred', async () => {
    const applyOutgoingThreadMessage = vi.fn();
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

  it('keeps retryFailedMessage identity stable while its dependencies change (Д2-3)', () => {
    const apiRef = { current: null };
    const { rerender } = render(
      <Harness apiRef={apiRef} applyOutgoingThreadMessage={vi.fn()} notifyApiError={vi.fn()} />,
    );
    const first = apiRef.current.retryFailedMessage;
    rerender(
      <Harness apiRef={apiRef} applyOutgoingThreadMessage={vi.fn()} notifyApiError={vi.fn()} />,
    );
    expect(apiRef.current.retryFailedMessage).toBe(first);
  });
});
