import { useCallback, useEffect, useRef } from 'react';

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
  const generationRef = useRef(0);
  useEffect(() => () => { generationRef.current += 1; }, []);
  const revealMessage = useCallback(async (messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId || !activeConversationIdRef.current) return false;
    const conversationId = activeConversationIdRef.current;
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current && activeConversationIdRef.current === conversationId;
    if (scrollToMessage(normalizedMessageId)) return true;

    let iterations = 0;
    while (shouldContinueRevealMessageSearch({
      messagesHasMore: messagesHasMoreRef.current,
      iterations,
    })) {
      if (!isCurrent()) return false;
      const oldestMessageId = String(messagesRef.current[0]?.id || '').trim();
      if (!oldestMessageId) break;
      const olderItems = await loadMessages(conversationId, {
        silent: true,
        beforeMessageId: oldestMessageId,
        reason: 'reveal:load_older',
      });
      if (!isCurrent()) return false;
      iterations += 1;
      if (!Array.isArray(olderItems) || olderItems.length === 0) break;
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      if (!isCurrent()) return false;
      if (scrollToMessage(normalizedMessageId)) return true;
    }
    return false;
  }, [activeConversationIdRef, loadMessages, messagesHasMoreRef, messagesRef, scrollToMessage]);

  useEffect(() => {
    revealMessageRef.current = revealMessage;
  }, [revealMessage, revealMessageRef]);

  return { revealMessage };
}
