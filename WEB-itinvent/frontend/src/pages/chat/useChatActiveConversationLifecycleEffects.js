import { useEffect, useLayoutEffect } from 'react';

export const CHAT_ACTIVE_CONVERSATION_CHANGED_EVENT = 'chat-active-conversation-changed';

export function buildChatActiveConversationChangedDetail(conversationId) {
  return { conversationId: String(conversationId || '').trim() };
}

export function dispatchChatActiveConversationChanged(conversationId, {
  dispatchEvent = typeof window !== 'undefined' ? window.dispatchEvent.bind(window) : undefined,
  CustomEventCtor = typeof window !== 'undefined' ? window.CustomEvent : undefined,
} = {}) {
  if (typeof dispatchEvent !== 'function' || typeof CustomEventCtor !== 'function') return;
  const detail = buildChatActiveConversationChangedDetail(conversationId);
  dispatchEvent(new CustomEventCtor(CHAT_ACTIVE_CONVERSATION_CHANGED_EVENT, { detail }));
}

export function buildRequestedMessageRevealKey(conversationId, messageId) {
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedConversationId || !normalizedMessageId) return '';
  return `${normalizedConversationId}:${normalizedMessageId}`;
}

export function resolveRequestedMessageRevealPlan({
  requestedMessageId,
  activeConversationId,
  requestedConversationId,
  messagesLoading,
  lastHandledRevealKey,
} = {}) {
  if (!requestedMessageId) {
    return { shouldReveal: false, resetRevealKey: true, revealKey: '' };
  }
  const normalizedConversationId = String(activeConversationId || '').trim();
  if (!normalizedConversationId || normalizedConversationId !== String(requestedConversationId || '').trim()) {
    return { shouldReveal: false, resetRevealKey: false, revealKey: '' };
  }
  if (messagesLoading) {
    return { shouldReveal: false, resetRevealKey: false, revealKey: '' };
  }
  const revealKey = buildRequestedMessageRevealKey(normalizedConversationId, requestedMessageId);
  if (!revealKey || revealKey === lastHandledRevealKey) {
    return { shouldReveal: false, resetRevealKey: false, revealKey };
  }
  return { shouldReveal: true, resetRevealKey: false, revealKey };
}

export function buildMessageSearchParamAfterReveal(search, requestedMessageId, {
  URLSearchParams: URLSearchParamsCtor = URLSearchParams,
} = {}) {
  const normalizedRequestedMessageId = String(requestedMessageId || '').trim();
  const nextParams = new URLSearchParamsCtor(search);
  if (String(nextParams.get('message') || '').trim() !== normalizedRequestedMessageId) {
    return null;
  }
  nextParams.delete('message');
  const nextSearch = nextParams.toString();
  return nextSearch ? `?${nextSearch}` : '';
}

export default function useChatActiveConversationLifecycleEffects({
  activeConversationId,
  activeConversationIdRef,
  closeAttachmentPreview,
  closeDocumentPreview,
  locationSearch,
  messagesLength,
  messagesLoading,
  navigate,
  requestedConversationId,
  requestedMessageId,
  requestedMessageRevealKeyRef,
  revealMessageRef,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setSelectedMessageIds,
  setThreadMenuAnchor,
}) {
  useEffect(() => {
    setSelectedMessageIds([]);
  }, [activeConversationId, setSelectedMessageIds]);

  useLayoutEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId, activeConversationIdRef]);

  useEffect(() => {
    dispatchChatActiveConversationChanged(activeConversationId);
    return () => {
      dispatchChatActiveConversationChanged('');
    };
  }, [activeConversationId]);

  useEffect(() => {
    closeAttachmentPreview();
    closeDocumentPreview();
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
  }, [
    activeConversationId,
    closeAttachmentPreview,
    closeDocumentPreview,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
  ]);

  useEffect(() => {
    const revealPlan = resolveRequestedMessageRevealPlan({
      requestedMessageId,
      activeConversationId,
      requestedConversationId,
      messagesLoading,
      lastHandledRevealKey: requestedMessageRevealKeyRef.current,
    });
    if (revealPlan.resetRevealKey) {
      requestedMessageRevealKeyRef.current = '';
      return undefined;
    }
    if (!revealPlan.shouldReveal) return undefined;

    let cancelled = false;
    const revealMessage = revealMessageRef.current;
    if (typeof revealMessage !== 'function') return undefined;

    void revealMessage(requestedMessageId).then((found) => {
      if (cancelled || !found) return;
      requestedMessageRevealKeyRef.current = revealPlan.revealKey;
      const nextSearch = buildMessageSearchParamAfterReveal(locationSearch, requestedMessageId);
      if (nextSearch === null) return;
      navigate({ pathname: '/chat', search: nextSearch }, { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeConversationId,
    locationSearch,
    messagesLength,
    messagesLoading,
    navigate,
    requestedConversationId,
    requestedMessageId,
    requestedMessageRevealKeyRef,
    revealMessageRef,
  ]);
}
