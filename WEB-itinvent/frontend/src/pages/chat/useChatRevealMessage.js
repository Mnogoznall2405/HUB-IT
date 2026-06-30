import { useCallback, useEffect } from 'react';

export const CHAT_REVEAL_MAX_ITERATIONS = 12;

export function shouldContinueRevealMessageSearch({
  messagesHasMore,
  iterations,
  maxIterations = CHAT_REVEAL_MAX_ITERATIONS,
} = {}) {
  return Boolean(messagesHasMore) && iterations < maxIterations;
}

export default function useChatRevealMessage({
  activeConversationIdRef,
  loadMessages,
  messagesHasMoreRef,
  messagesRef,
  revealMessageRef,
  scrollToMessage,
}) {
  const revealMessage = useCallback(async (messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId || !activeConversationIdRef.current) return false;
    if (scrollToMessage(normalizedMessageId)) return true;

    let iterations = 0;
    while (shouldContinueRevealMessageSearch({
      messagesHasMore: messagesHasMoreRef.current,
      iterations,
    })) {
      const oldestMessageId = String(messagesRef.current[0]?.id || '').trim();
      if (!oldestMessageId) break;
      const olderItems = await loadMessages(activeConversationIdRef.current, {
        silent: true,
        beforeMessageId: oldestMessageId,
        reason: 'reveal:load_older',
      });
      iterations += 1;
      if (!Array.isArray(olderItems) || olderItems.length === 0) break;
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      if (scrollToMessage(normalizedMessageId)) return true;
    }
    return false;
  }, [activeConversationIdRef, loadMessages, messagesHasMoreRef, messagesRef, scrollToMessage]);

  useEffect(() => {
    revealMessageRef.current = revealMessage;
  }, [revealMessage, revealMessageRef]);

  return { revealMessage };
}
