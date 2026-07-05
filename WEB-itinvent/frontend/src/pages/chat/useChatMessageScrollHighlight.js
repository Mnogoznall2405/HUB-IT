import { useCallback, useEffect } from 'react';

import { CHAT_MESSAGE_HIGHLIGHT_MS } from './chatPageConstants';
import { emitChatUnreadRefresh } from './chatUnreadRefresh';

export function scheduleMessageHighlight({
  messageId,
  setHighlightedMessageId,
  highlightResetTimeoutRef,
  highlightMs = CHAT_MESSAGE_HIGHLIGHT_MS,
}) {
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedMessageId) return false;
  setHighlightedMessageId(normalizedMessageId);
  if (highlightResetTimeoutRef.current) {
    window.clearTimeout(highlightResetTimeoutRef.current);
  }
  highlightResetTimeoutRef.current = window.setTimeout(() => {
    setHighlightedMessageId((current) => (current === normalizedMessageId ? '' : current));
  }, highlightMs);
  return true;
}

export function scrollThreadToMessage({
  messageId,
  threadScrollRef,
  cancelPendingInitialAnchor,
  traceProgrammaticThreadScroll,
  highlightMessage,
}) {
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedMessageId) return false;
  cancelPendingInitialAnchor();
  const selector = `[data-chat-message-id="${normalizedMessageId}"]`;
  const target = threadScrollRef.current?.querySelector?.(selector);
  if (!target) return false;
  traceProgrammaticThreadScroll('scrollToMessage', {
    messageId: normalizedMessageId,
    behavior: 'smooth',
    block: 'center',
  });
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightMessage(normalizedMessageId);
  return true;
}

export default function useChatMessageScrollHighlight({
  cancelPendingInitialAnchor,
  highlightResetTimeoutRef,
  scrollToMessageRef,
  setHighlightedMessageId,
  threadScrollRef,
  traceProgrammaticThreadScroll,
}) {
  const highlightMessage = useCallback((messageId) => {
    scheduleMessageHighlight({
      messageId,
      setHighlightedMessageId,
      highlightResetTimeoutRef,
    });
  }, [highlightResetTimeoutRef, setHighlightedMessageId]);

  const scrollToMessage = useCallback((messageId) => scrollThreadToMessage({
    messageId,
    threadScrollRef,
    cancelPendingInitialAnchor,
    traceProgrammaticThreadScroll,
    highlightMessage,
  }), [
    cancelPendingInitialAnchor,
    highlightMessage,
    threadScrollRef,
    traceProgrammaticThreadScroll,
  ]);

  useEffect(() => {
    scrollToMessageRef.current = scrollToMessage;
  }, [scrollToMessage, scrollToMessageRef]);

  return {
    emitChatUnreadRefresh,
    highlightMessage,
    scrollToMessage,
  };
}
