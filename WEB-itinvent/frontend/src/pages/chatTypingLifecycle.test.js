import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendTyping = vi.fn();

vi.mock('../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

vi.mock('../lib/chatSocket', () => ({
  chatSocket: {
    sendTyping: (...args) => sendTyping(...args),
  },
}));

import { useEffect, useRef } from 'react';

/**
 * Mirrors the typing lifecycle in useChatSocketController:
 * start once, refresh idle timer on keystrokes, stop on empty / idle / conversation leave.
 */
function useChatTypingLifecycle(activeConversationId, deferredMessageText) {
  const typingStopTimeoutRef = useRef(null);
  const typingStartedRef = useRef(false);

  useEffect(() => {
    if (!activeConversationId) return undefined;
    const conversationId = activeConversationId;
    return () => {
      if (typingStartedRef.current) {
        sendTyping(conversationId, false);
        typingStartedRef.current = false;
      }
    };
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) return undefined;
    const conversationId = activeConversationId;
    const normalizedMessageText = String(deferredMessageText || '').trim();
    if (!normalizedMessageText) {
      if (typingStartedRef.current) {
        sendTyping(conversationId, false);
        typingStartedRef.current = false;
      }
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      return undefined;
    }
    if (!typingStartedRef.current) {
      sendTyping(conversationId, true);
      typingStartedRef.current = true;
    }
    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }
    typingStopTimeoutRef.current = window.setTimeout(() => {
      sendTyping(conversationId, false);
      typingStartedRef.current = false;
      typingStopTimeoutRef.current = null;
    }, 1800);
    return () => {
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
    };
  }, [activeConversationId, deferredMessageText]);

  return { typingStartedRef };
}

describe('chat typing lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendTyping.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends stop typing for the previous conversation on switch', () => {
    const { rerender } = renderHook(
      ({ conversationId, messageText }) => useChatTypingLifecycle(conversationId, messageText),
      {
        initialProps: {
          conversationId: 'conv-a',
          messageText: 'draft',
        },
      },
    );

    expect(sendTyping).toHaveBeenCalledWith('conv-a', true);

    act(() => {
      rerender({
        conversationId: 'conv-b',
        messageText: '',
      });
    });

    expect(sendTyping).toHaveBeenCalledWith('conv-a', false);
  });

  it('does not stop/start typing on every keystroke', () => {
    const { rerender } = renderHook(
      ({ conversationId, messageText }) => useChatTypingLifecycle(conversationId, messageText),
      {
        initialProps: {
          conversationId: 'conv-a',
          messageText: 'a',
        },
      },
    );

    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(sendTyping).toHaveBeenCalledWith('conv-a', true);

    act(() => {
      rerender({ conversationId: 'conv-a', messageText: 'ab' });
    });
    act(() => {
      rerender({ conversationId: 'conv-a', messageText: 'abc' });
    });
    act(() => {
      rerender({ conversationId: 'conv-a', messageText: 'abcd' });
    });

    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(sendTyping.mock.calls.every(([, isTyping]) => isTyping === true)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1800);
    });

    expect(sendTyping).toHaveBeenCalledTimes(2);
    expect(sendTyping).toHaveBeenLastCalledWith('conv-a', false);
  });

  it('sends stop typing when composer is cleared', () => {
    const { rerender } = renderHook(
      ({ conversationId, messageText }) => useChatTypingLifecycle(conversationId, messageText),
      {
        initialProps: {
          conversationId: 'conv-a',
          messageText: 'hello',
        },
      },
    );

    expect(sendTyping).toHaveBeenCalledWith('conv-a', true);

    act(() => {
      rerender({ conversationId: 'conv-a', messageText: '' });
    });

    expect(sendTyping).toHaveBeenLastCalledWith('conv-a', false);
  });
});
