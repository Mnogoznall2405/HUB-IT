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

function useChatTypingLifecycle(activeConversationId, deferredMessageText) {
  const typingStopTimeoutRef = useRef(null);
  const typingStartedRef = useRef(false);

  useEffect(() => {
    if (!activeConversationId) return undefined;
    const normalizedMessageText = String(deferredMessageText || '').trim();
    if (!normalizedMessageText) {
      if (typingStartedRef.current) {
        sendTyping(activeConversationId, false);
        typingStartedRef.current = false;
      }
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      return undefined;
    }
    if (!typingStartedRef.current) {
      sendTyping(activeConversationId, true);
      typingStartedRef.current = true;
    }
    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }
    typingStopTimeoutRef.current = window.setTimeout(() => {
      sendTyping(activeConversationId, false);
      typingStartedRef.current = false;
      typingStopTimeoutRef.current = null;
    }, 1800);
    return () => {
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      if (typingStartedRef.current) {
        sendTyping(activeConversationId, false);
        typingStartedRef.current = false;
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
});
