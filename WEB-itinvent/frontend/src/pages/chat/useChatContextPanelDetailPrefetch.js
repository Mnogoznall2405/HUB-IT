import { useEffect } from 'react';

export function normalizeActiveConversationId(conversationId) {
  return String(conversationId || '').trim();
}

export function shouldPrefetchConversationDetail({
  activeConversationId,
  contextPanelOpen = false,
  infoOpen = false,
} = {}) {
  const normalizedConversationId = normalizeActiveConversationId(activeConversationId);
  if (!normalizedConversationId) return false;
  return contextPanelOpen || infoOpen;
}

export default function useChatContextPanelDetailPrefetch({
  activeConversationId,
  contextPanelOpen,
  infoOpen,
  loadConversationDetail,
}) {
  useEffect(() => {
    const normalizedConversationId = normalizeActiveConversationId(activeConversationId);
    if (!shouldPrefetchConversationDetail({
      activeConversationId: normalizedConversationId,
      contextPanelOpen,
      infoOpen,
    })) {
      return undefined;
    }

    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    void loadConversationDetail(normalizedConversationId, { signal: abortController?.signal }).catch(() => {});
    return () => {
      try {
        abortController?.abort?.();
      } catch {
        // Ignore detail abort cleanup failures.
      }
    };
  }, [activeConversationId, contextPanelOpen, infoOpen, loadConversationDetail]);
}
