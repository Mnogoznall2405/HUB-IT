import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatStickersAPI } from '../../api/chatStickers';
import useChatStickerSending from './useChatStickerSending';

vi.mock('../../api/chatStickers', () => ({
  chatStickersAPI: {
    sendSticker: vi.fn(),
  },
}));

const buildProps = (overrides = {}) => ({
  activeConversationId: 'conversation-1',
  applyOutgoingThreadMessage: vi.fn(),
  cancelPendingInitialAnchor: vi.fn(),
  notifyApiError: vi.fn(),
  replyMessage: { id: 'reply-1' },
  setEmojiAnchorEl: vi.fn(),
  setReplyMessage: vi.fn(),
  ...overrides,
});

describe('useChatStickerSending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a sticker and merges the returned chat message', async () => {
    const props = buildProps();
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
      { reply_to_message_id: 'reply-1' },
    );
    expect(props.applyOutgoingThreadMessage).toHaveBeenCalledWith(
      'conversation-1',
      message,
      { scroll: true, scrollSource: 'sendSticker' },
    );
    expect(props.setReplyMessage).toHaveBeenCalledWith(null);
    expect(props.cancelPendingInitialAnchor).toHaveBeenCalledTimes(1);
    expect(props.setEmojiAnchorEl).not.toHaveBeenCalled();
  });

  it('reports API errors and leaves the composer usable', async () => {
    const props = buildProps({ replyMessage: null });
    const error = new Error('network');
    chatStickersAPI.sendSticker.mockRejectedValue(error);
    const { result } = renderHook(() => useChatStickerSending(props));

    let sent;
    await act(async () => {
      sent = await result.current({ id: 'sticker-1' });
    });

    expect(sent).toBe(false);
    expect(props.notifyApiError).toHaveBeenCalledWith(error, 'Не удалось отправить стикер.');
    expect(props.setReplyMessage).not.toHaveBeenCalled();
  });
});
