import { useCallback } from 'react';

import { chatAPI } from '../../api/client';
import { invalidateSWRCacheByPrefix } from '../../lib/swrCache';

export function mergeConversationDetailRecord(current, conversation) {
  const normalizedConversationId = String(conversation?.id || '').trim();
  if (!normalizedConversationId) return current;
  return {
    ...current,
    [normalizedConversationId]: {
      ...(current[normalizedConversationId] || {}),
      ...conversation,
      member_preview: Array.isArray(conversation?.member_preview)
        ? conversation.member_preview
        : (current[normalizedConversationId]?.member_preview || []),
      members: Array.isArray(conversation?.members)
        ? conversation.members
        : current[normalizedConversationId]?.members,
    },
  };
}

export default function useChatConversationDetailService({
  conversationDetailsByIdRef,
  lastConversationSessionKey,
  lastMobileViewSessionKey,
  setConversationDetailsById,
  userCacheId,
}) {
  const clearStoredConversationState = useCallback(({ conversationId = '', invalidateThread = false } = {}) => {
    try {
      window.sessionStorage.removeItem(lastConversationSessionKey);
      window.sessionStorage.removeItem(lastMobileViewSessionKey);
    } catch {
      // Ignore browser storage failures for chat session restore.
    }
    if (invalidateThread) {
      const normalizedConversationId = String(conversationId || '').trim();
      if (normalizedConversationId) {
        invalidateSWRCacheByPrefix('chat', 'thread', userCacheId, normalizedConversationId);
      }
    }
  }, [lastConversationSessionKey, lastMobileViewSessionKey, userCacheId]);

  const upsertConversationDetail = useCallback((conversation) => {
    const normalizedConversationId = String(conversation?.id || '').trim();
    if (!normalizedConversationId) return;
    setConversationDetailsById((current) => mergeConversationDetailRecord(current, conversation));
  }, [setConversationDetailsById]);

  const loadConversationDetail = useCallback(async (conversationId, { force = false, signal } = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return null;
    if (typeof chatAPI.getConversation !== 'function') return null;
    const existingDetail = conversationDetailsByIdRef.current[normalizedConversationId];
    if (!force && Array.isArray(existingDetail?.members) && existingDetail.members.length > 0) {
      return existingDetail;
    }
    if (
      !force
      && Array.isArray(existingDetail?.member_preview)
      && existingDetail.member_preview.length > 0
      && !Array.isArray(existingDetail?.members)
    ) {
      return existingDetail;
    }
    const detail = await chatAPI.getConversation(normalizedConversationId, { signal });
    if (detail?.id) {
      upsertConversationDetail(detail);
    }
    return detail;
  }, [conversationDetailsByIdRef, upsertConversationDetail]);

  return {
    clearStoredConversationState,
    loadConversationDetail,
    upsertConversationDetail,
  };
}
