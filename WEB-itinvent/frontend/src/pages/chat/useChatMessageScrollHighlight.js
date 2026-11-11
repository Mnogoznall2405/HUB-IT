import { useCallback, useEffect } from 'react';

import { CHAT_MESSAGE_HIGHLIGHT_MS } from './chatPageConstants';
import { emitChatUnreadRefresh } from './chatUnreadRefresh';
import { getChatThreadRenderWindow } from '../../lib/chat/chatThreadRenderWindow';

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
  if (!target) {
    // Сообщение загружено, но вне окна рендера: окно центрируется на нём,
    // прокрутка и подсветка — после монтирования.
    const renderWindow = getChatThreadRenderWindow(threadScrollRef.current);
    return Boolean(renderWindow?.ensureMessageRendered?.(normalizedMessageId, (container) => {
      const node = container?.querySelector?.(selector);
      if (!node) return;
      traceProgrammaticThreadScroll('scrollToMessage:renderWindow', {
        messageId: normalizedMessageId,
        behavior: 'auto',
        block: 'center',
      });
      node.scrollIntoView({ behavior: 'auto', block: 'center' });
      highlightMessage(normalizedMessageId);
    }));
  }
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
