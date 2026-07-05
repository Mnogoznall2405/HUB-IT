import { useCallback, useEffect } from 'react';

import { chatAPI } from '../../api/client';
import { resolveLatestMessageIdInOrder } from '../../components/chat/chatHelpers';
import { CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { chatSocket } from '../../lib/chatSocket';

export default function useChatMarkReadLive({
  activeConversationIdRef,
  emitChatUnreadRefresh,
  markConversationReadLiveRef,
  messagesRef,
  setViewerLastReadAt,
  setViewerLastReadMessageId,
  syncConversationUnreadState,
}) {
  const markConversationReadLive = useCallback(async (conversationId, messageId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedConversationId || !normalizedMessageId) return null;
    let payload = null;
    if (CHAT_WS_ENABLED) {
      try {
        payload = await chatSocket.markRead(normalizedConversationId, normalizedMessageId);
      } catch {
        // Fallback to HTTP below.
      }
    }
    if (!payload) {
      payload = await chatAPI.markRead(normalizedConversationId, normalizedMessageId);
    }
    const resolvedMessageId = String(payload?.message_id || normalizedMessageId).trim();
    if (activeConversationIdRef.current === normalizedConversationId && resolvedMessageId) {
      setViewerLastReadMessageId((current) => resolveLatestMessageIdInOrder(
        messagesRef.current,
        current,
        resolvedMessageId,
      ));
      setViewerLastReadAt((current) => String(payload?.read_at || '').trim() || current);
      syncConversationUnreadState(normalizedConversationId, resolvedMessageId);
    }
    emitChatUnreadRefresh();
    return payload;
  }, [
    activeConversationIdRef,
    emitChatUnreadRefresh,
    messagesRef,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    syncConversationUnreadState,
  ]);

  useEffect(() => {
    markConversationReadLiveRef.current = markConversationReadLive;
  }, [markConversationReadLive, markConversationReadLiveRef]);

  return { markConversationReadLive };
}
