import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatStickersAPI } from '../../api/chatStickers';
import useChatStickerSending from './useChatStickerSending';

vi.mock('../../api/chatStickers', () => ({
  chatStickersAPI: {
    sendSticker: vi.fn(),
  },
}));

let optimisticStickerSeq = 0;
const buildOptimisticSticker = () => ({
  id: `optimistic-sticker-${optimisticStickerSeq}`,
  client_message_id: `client-sticker-${(optimisticStickerSeq += 1)}`,
  conversation_id: 'conversation-1',
  kind: 'file',
  attachments: [{ kind: 'sticker', media_kind: 'sticker' }],
  isOptimistic: true,
  optimisticStatus: 'sending',
});

const buildProps = (overrides = {}) => ({
  activeConversationId: 'conversation-1',
  applyOutgoingThreadMessage: vi.fn(),
  buildReplyPreview: vi.fn(() => null),
  cancelPendingInitialAnchor: vi.fn(),
  createOptimisticStickerMessage: vi.fn(() => buildOptimisticSticker()),
  notifyApiError: vi.fn(),
  registerFailedOutgoingMessage: vi.fn(),
  replyMessage: { id: 'reply-1' },
  setEmojiAnchorEl: vi.fn(),
  setReplyMessage: vi.fn(),
  ...overrides,
});

describe('useChatStickerSending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an optimistic bubble, then replaces it with the server message', async () => {
    const props = buildProps();
    const message = { id: 'message-1', kind: 'file', attachments: [{ kind: 'sticker' }] };
    chatStickersAPI.sendSticker.mockResolvedValue(message);
    const { result } = renderHook(() => useChatStickerSending(props));

    let sent;
    await act(async () => {
      sent = await result.current({ id: 'sticker-1', file_url: '/api/v1/chat/stickers/sticker-1/file' });
    });

    expect(sent).toBe(true);
    const optimistic = props.applyOutgoingThreadMessage.mock.calls[0][1];
    expect(optimistic).toEqual(expect.objectContaining({
      optimisticStatus: 'sending',
      isOptimistic: true,
    }));
    expect(props.applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      1,
      'conversation-1',
      optimistic,
      { scroll: true, scrollSource: 'sendSticker' },
    );
    expect(props.applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      2,
      'conversation-1',
      message,
      { replaceId: optimistic.id, scroll: false, scrollSource: 'sendSticker' },
    );
    expect(chatStickersAPI.sendSticker).toHaveBeenCalledWith(
      'conversation-1',
      'sticker-1',
      {
        client_message_id: optimistic.client_message_id,
        reply_to_message_id: 'reply-1',
      },
    );
    expect(props.setReplyMessage).toHaveBeenCalledWith(null);
    expect(props.cancelPendingInitialAnchor).toHaveBeenCalled();
    expect(props.registerFailedOutgoingMessage).not.toHaveBeenCalled();
  });

  it('falls back to the plain send when no optimistic bubble can be built', async () => {
    const props = buildProps({ createOptimisticStickerMessage: undefined });
    const message = { id: 'message-1', kind: 'file', attachments: [{ kind: 'sticker' }] };
    chatStickersAPI.sendSticker.mockResolvedValue(message);
    const { result } = renderHook(() => useChatStickerSending(props));

    let sent;
    await act(async () => {
      sent = await result.current({ id: 'sticker-1' });
    });

    expect(sent).toBe(true);
    expect(chatStickersAPI.sendSticker).toHaveBeenCalledWith(
      'conversation-1',
      'sticker-1',
      {
        client_message_id: expect.stringMatching(/^chat-client:conversation-1:\d+:\d+$/),
        reply_to_message_id: 'reply-1',
      },
    );
    expect(props.applyOutgoingThreadMessage).toHaveBeenCalledWith(
      'conversation-1',
      message,
      expect.objectContaining({ scroll: true, scrollSource: 'sendSticker' }),
    );
  });

  it('registers a retryable failed sticker bubble on API errors', async () => {
    const props = buildProps({ replyMessage: null });
    const error = new Error('network');
    chatStickersAPI.sendSticker.mockRejectedValue(error);
    const { result } = renderHook(() => useChatStickerSending(props));

    let sent;
    await act(async () => {
      sent = await result.current({ id: 'sticker-1', file_url: '/file' });
    });

    expect(sent).toBe(false);
    expect(props.registerFailedOutgoingMessage).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ isOptimistic: true, optimisticStatus: 'sending' }),
      expect.objectContaining({ stickerResend: { stickerId: 'sticker-1' } }),
    );
    expect(props.notifyApiError).toHaveBeenCalledWith(error, 'Не удалось отправить стикер.');
    expect(props.setReplyMessage).toHaveBeenCalledWith(null);
  });

  it('blocks a second send while the first request is still in flight', async () => {
    const props = buildProps({ replyMessage: null });
    let resolveSend;
    chatStickersAPI.sendSticker.mockImplementation(
      () => new Promise((resolve) => { resolveSend = resolve; }),
    );
    const { result } = renderHook(() => useChatStickerSending(props));

    let firstPromise;
    await act(async () => {
      firstPromise = result.current({ id: 'sticker-1' });
    });
    let second;
    await act(async () => {
      second = await result.current({ id: 'sticker-1' });
    });
    expect(second).toBe(false);
    expect(chatStickersAPI.sendSticker).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend({ id: 'message-1' });
      await firstPromise;
    });
    // After the response the sender is usable again.
    let third;
    chatStickersAPI.sendSticker.mockResolvedValue({ id: 'message-2' });
    await act(async () => {
      third = await result.current({ id: 'sticker-1' });
    });
    expect(third).toBe(true);
    expect(chatStickersAPI.sendSticker).toHaveBeenCalledTimes(2);
    expect(chatStickersAPI.sendSticker.mock.calls[0][2].client_message_id)
      .not.toBe(chatStickersAPI.sendSticker.mock.calls[1][2].client_message_id);
  });

  it('sends different stickers in parallel — only the same sticker is deduplicated', async () => {
    const props = buildProps({ replyMessage: null });
    const resolvers = [];
    chatStickersAPI.sendSticker.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    );
    const { result } = renderHook(() => useChatStickerSending(props));

    let firstPromise;
    let secondPromise;
    let secondSameSticker;
    await act(async () => {
      firstPromise = result.current({ id: 'sticker-1' });
      secondPromise = result.current({ id: 'sticker-2' });
      secondSameSticker = result.current({ id: 'sticker-1' });
    });

    // Второй клик по тому же стикеру проглатывается, другой стикер уходит.
    expect(await secondSameSticker).toBe(false);
    expect(chatStickersAPI.sendSticker).toHaveBeenCalledTimes(2);
    const sentStickerIds = chatStickersAPI.sendSticker.mock.calls.map((call) => call[1]);
    expect(sentStickerIds).toEqual(['sticker-1', 'sticker-2']);
    expect(chatStickersAPI.sendSticker.mock.calls[0][2].client_message_id)
      .not.toBe(chatStickersAPI.sendSticker.mock.calls[1][2].client_message_id);

    await act(async () => {
      resolvers.forEach((resolve, index) => resolve({ id: `message-${index}` }));
      await Promise.all([firstPromise, secondPromise]);
    });
    expect(await firstPromise).toBe(true);
    expect(await secondPromise).toBe(true);
  });

  it('releases the sticker lock when history preparation throws — retry succeeds', async () => {
    const props = buildProps({
      replyMessage: null,
      ensureLatestThreadWindow: vi.fn(() => Promise.reject(new Error('history prep failed'))),
    });
    const { result } = renderHook(() => useChatStickerSending(props));

    let first;
    await act(async () => {
      first = await result.current({ id: 'sticker-1' });
    });
    expect(first).toBe(false);
    expect(props.notifyApiError).toHaveBeenCalled();
    expect(chatStickersAPI.sendSticker).not.toHaveBeenCalled();

    // Блокировка снята: тот же стикер можно отправить повторно.
    props.ensureLatestThreadWindow.mockResolvedValue(undefined);
    chatStickersAPI.sendSticker.mockResolvedValue({ id: 'message-1' });
    let second;
    await act(async () => {
      second = await result.current({ id: 'sticker-1' });
    });
    expect(second).toBe(true);
    expect(chatStickersAPI.sendSticker).toHaveBeenCalledTimes(1);
  });

  it('does not block the same sticker in another conversation while one is in flight', async () => {
    const props = buildProps({ replyMessage: null });
    const resolvers = [];
    chatStickersAPI.sendSticker.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    );
    const { result, rerender } = renderHook(
      ({ conversationId }) => useChatStickerSending({
        ...props,
        activeConversationId: conversationId,
      }),
      { initialProps: { conversationId: 'conversation-1' } },
    );

    let firstPromise;
    await act(async () => {
      firstPromise = result.current({ id: 'sticker-1' });
    });
    // Тот же стикер в другой беседе — отдельный лок, отправка идёт.
    rerender({ conversationId: 'conversation-2' });
    let secondPromise;
    await act(async () => {
      secondPromise = result.current({ id: 'sticker-1' });
    });

    expect(chatStickersAPI.sendSticker).toHaveBeenCalledTimes(2);
    expect(chatStickersAPI.sendSticker.mock.calls[0][0]).toBe('conversation-1');
    expect(chatStickersAPI.sendSticker.mock.calls[1][0]).toBe('conversation-2');

    await act(async () => {
      resolvers.forEach((resolve, index) => resolve({ id: `message-${index}` }));
      await Promise.all([firstPromise, secondPromise]);
    });
    expect(await firstPromise).toBe(true);
    expect(await secondPromise).toBe(true);
  });
});
