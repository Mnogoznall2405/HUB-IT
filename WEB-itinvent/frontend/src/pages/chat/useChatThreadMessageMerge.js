import { startTransition, useCallback } from 'react';

import { emitAgentDebugLog } from '../../lib/debugClientLog';
import {
  removeThreadMessageFromList,
  resolveThreadMessageMerge,
  upsertThreadMessagesInList,
} from './chatThreadMessageMerge';

export default function useChatThreadMessageMerge({
  activeConversationIdRef,
  isLikelyOptimisticReplacement,
  messagesRef,
  promoteConversationToTop,
  queueAutoScroll,
  setMessages,
  setViewerLastReadAt,
  setViewerLastReadMessageId,
  syncConversationPreview,
  withStableMessageRenderKey,
}) {
  const upsertThreadMessages = useCallback((incomingMessages, { replaceByMessageId = null } = {}) => {
    const activeConversationId = String(activeConversationIdRef.current || '').trim();
    if (!activeConversationId) return;
    const incoming = Array.isArray(incomingMessages) ? incomingMessages : [incomingMessages];
    const accepted = incoming.filter((message) => {
      const normalizedConversationId = String(message?.conversation_id || '').trim();
      return message?.id && normalizedConversationId && normalizedConversationId === activeConversationId;
    }).length;
    // #region agent log
    emitAgentDebugLog({
      location: 'useChatThreadMessageMerge.js:upsertThreadMessages',
      message: accepted > 0 ? 'upsert accepted messages' : 'upsert filtered all messages',
      hypothesisId: 'H3',
      data: {
        activeConversationId,
        incomingCount: incoming.length,
        acceptedCount: accepted,
        sampleConversationId: String(incoming[0]?.conversation_id || '').trim(),
        sampleMessageId: String(incoming[0]?.id || '').trim(),
      },
    });
    // #endregion
    setMessages((current) => upsertThreadMessagesInList(current, incomingMessages, {
      activeConversationId,
      replaceByMessageId,
      withStableMessageRenderKey,
    }));
  }, [activeConversationIdRef, setMessages, withStableMessageRenderKey]);

  const upsertThreadMessage = useCallback((message, { replaceId = '' } = {}) => {
    if (!message?.id) return;
    const messageId = String(message.id || '').trim();
    const normalizedReplaceId = String(replaceId || '').trim();
    const replaceByMessageId = normalizedReplaceId && messageId
      ? new Map([[messageId, normalizedReplaceId]])
      : null;
    upsertThreadMessages([message], { replaceByMessageId });
  }, [upsertThreadMessages]);

  const mergeMessageIntoThread = useCallback((message) => {
    const resolved = resolveThreadMessageMerge(message, messagesRef.current, {
      isLikelyOptimisticReplacement,
      withStableMessageRenderKey,
    });
    if (!resolved) return;
    upsertThreadMessage(resolved.message, { replaceId: resolved.replaceId });
  }, [
    isLikelyOptimisticReplacement,
    messagesRef,
    upsertThreadMessage,
    withStableMessageRenderKey,
  ]);

  const applyOutgoingThreadMessage = useCallback((conversationId, message, {
    replaceId = '',
    previewOverrides = { unread_count: 0 },
    scroll = false,
    scrollSource = 'outgoingMessage',
    promote = true,
  } = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId || !message?.id) return false;

    upsertThreadMessage(message, { replaceId });
    const isActiveConversation = normalizedConversationId === String(activeConversationIdRef.current || '').trim();
    if (isActiveConversation && message?.is_own && !message?.isOptimistic) {
      setViewerLastReadMessageId(String(message.id || '').trim());
      setViewerLastReadAt(String(message.created_at || '').trim());
    }
    startTransition(() => {
      syncConversationPreview(normalizedConversationId, message, previewOverrides);
      if (promote) promoteConversationToTop(normalizedConversationId);
    });
    if (scroll && isActiveConversation) {
      queueAutoScroll('bottom_instant', scrollSource, { userInitiated: true });
    }
    return true;
  }, [
    activeConversationIdRef,
    promoteConversationToTop,
    queueAutoScroll,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    syncConversationPreview,
    upsertThreadMessage,
  ]);

  const removeThreadMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return;
    setMessages((current) => removeThreadMessageFromList(current, normalizedMessageId));
  }, [setMessages]);

  return {
    applyOutgoingThreadMessage,
    mergeMessageIntoThread,
    removeThreadMessage,
    upsertThreadMessage,
    upsertThreadMessages,
  };
}
