import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatReactionAndPinController from './useChatReactionAndPinController';

vi.mock('../../api/client', () => ({
  chatAPI: {
    toggleReaction: vi.fn(),
  },
}));

import { chatAPI } from '../../api/client';

describe('useChatReactionAndPinController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleToggleReaction patches message reactions', async () => {
    chatAPI.toggleReaction.mockResolvedValue({
      message_id: 'msg-1',
      reactions: [{ emoji: '👍', count: 1 }],
    });
    const setMessages = vi.fn((updater) => updater([{ id: 'msg-1', reactions: [] }]));

    const { result } = renderHook(() => useChatReactionAndPinController({
      activeConversationIdRef: { current: 'conv-1' },
      notifyApiError: vi.fn(),
      notifyInfo: vi.fn(),
      persistPinnedMessage: vi.fn(),
      pinnedMessage: null,
      revealMessage: vi.fn(),
      setMessages,
    }));

    await act(async () => {
      await result.current.handleToggleReaction('msg-1', '👍');
    });

    expect(chatAPI.toggleReaction).toHaveBeenCalledWith('conv-1', 'msg-1', '👍');
    expect(setMessages).toHaveBeenCalled();
  });

  it('handleOpenPinnedMessage reveals pinned message or notifies', async () => {
    const revealMessage = vi.fn().mockResolvedValue(false);
    const notifyInfo = vi.fn();

    const { result } = renderHook(() => useChatReactionAndPinController({
      activeConversationIdRef: { current: 'conv-1' },
      notifyApiError: vi.fn(),
      notifyInfo,
      persistPinnedMessage: vi.fn(),
      pinnedMessage: { id: 'pin-1' },
      revealMessage,
      setMessages: vi.fn(),
    }));

    await act(async () => {
      await result.current.handleOpenPinnedMessage();
    });

    expect(revealMessage).toHaveBeenCalledWith('pin-1');
    expect(notifyInfo).toHaveBeenCalled();
  });

  it('handleUnpinPinnedMessage clears pinned message', () => {
    const persistPinnedMessage = vi.fn();

    const { result } = renderHook(() => useChatReactionAndPinController({
      activeConversationIdRef: { current: 'conv-1' },
      notifyApiError: vi.fn(),
      notifyInfo: vi.fn(),
      persistPinnedMessage,
      pinnedMessage: { id: 'pin-1' },
      revealMessage: vi.fn(),
      setMessages: vi.fn(),
    }));

    act(() => {
      result.current.handleUnpinPinnedMessage();
    });

    expect(persistPinnedMessage).toHaveBeenCalledWith(null);
  });
});
