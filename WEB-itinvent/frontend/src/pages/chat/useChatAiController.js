import { useCallback } from 'react';

import { chatAPI } from '../../api/client';
import { getOrFetchSWR, peekSWRCache } from '../../lib/swrCache';
import { buildChatAiBotsCacheKeyParts } from './chatCacheKeys';
import { mergeAiStatusPayload, shouldRequestConversationAiStatus } from './chatAiModel';

export default function useChatAiController({
  userCacheId,
  canUseAiChat,
  notifyApiError,
  setAiBots,
  setAiBotsLoading,
  setAiBotsError,
  setAiStatusByConversation,
  aiBotsCacheKeyParts,
  aiBotsRequestSeqRef,
  aiBotsLoadingRequestSeqRef,
  aiBotsLoadingRef,
  aiBotsCacheHydratedRef,
  staleTimeMs = 30_000,
}) {
  const applyAiBotsPayload = useCallback((payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    aiBotsCacheHydratedRef.current = true;
    setAiBots(items);
    setAiBotsError('');
    return items;
  }, [aiBotsCacheHydratedRef, setAiBots, setAiBotsError]);

  const loadAiBots = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!canUseAiChat) {
      setAiBots([]);
      setAiBotsError('');
      setAiBotsLoading(false);
      return [];
    }

    const requestSeq = aiBotsRequestSeqRef.current + 1;
    aiBotsRequestSeqRef.current = requestSeq;
    if (!silent) {
      aiBotsLoadingRequestSeqRef.current = requestSeq;
      setAiBotsLoading(true);
    } else if (aiBotsLoadingRef.current) {
      aiBotsLoadingRequestSeqRef.current = requestSeq;
    }
    setAiBotsError('');

    try {
      const cacheKeyParts = aiBotsCacheKeyParts || buildChatAiBotsCacheKeyParts(userCacheId);
      const cachedEntry = !silent && !force
        ? peekSWRCache(cacheKeyParts, { staleTimeMs })
        : null;

      if (cachedEntry?.data) {
        if (requestSeq !== aiBotsRequestSeqRef.current) return [];
        const items = applyAiBotsPayload(cachedEntry.data);
        if (requestSeq === aiBotsLoadingRequestSeqRef.current) {
          aiBotsLoadingRequestSeqRef.current = 0;
          setAiBotsLoading(false);
        }
        if (!cachedEntry.isFresh) {
          void loadAiBots({ silent: true, force: true }).catch(() => {});
        }
        return items;
      }

      const result = await getOrFetchSWR(
        cacheKeyParts,
        () => chatAPI.listAiBots(),
        {
          staleTimeMs,
          force,
          revalidateStale: false,
        },
      );
      if (requestSeq !== aiBotsRequestSeqRef.current) return [];
      const items = applyAiBotsPayload(result.data);
      if (result.fromCache && !result.isFresh && !force) {
        void loadAiBots({ silent: true, force: true }).catch(() => {});
      }
      return items;
    } catch (error) {
      if (!silent) notifyApiError(error, 'Не удалось загрузить AI-ботов.');
      setAiBots([]);
      setAiBotsError('Failed to load AI bots.');
      return [];
    } finally {
      if (requestSeq === aiBotsLoadingRequestSeqRef.current) {
        aiBotsLoadingRequestSeqRef.current = 0;
        setAiBotsLoading(false);
      }
    }
  }, [
    aiBotsCacheHydratedRef,
    aiBotsCacheKeyParts,
    aiBotsLoadingRef,
    aiBotsLoadingRequestSeqRef,
    aiBotsRequestSeqRef,
    applyAiBotsPayload,
    canUseAiChat,
    notifyApiError,
    setAiBots,
    setAiBotsError,
    setAiBotsLoading,
    staleTimeMs,
    userCacheId,
  ]);

  const fetchConversationAiStatus = useCallback(async ({ conversationId, conversationKind }) => {
    if (!shouldRequestConversationAiStatus({ conversationId, conversationKind, canUseAiChat })) {
      return null;
    }
    const status = await chatAPI.getConversationAiStatus(conversationId);
    if (status?.conversation_id) {
      setAiStatusByConversation((current) => mergeAiStatusPayload(current, status));
    }
    return status;
  }, [canUseAiChat, setAiStatusByConversation]);

  return {
    applyAiBotsPayload,
    loadAiBots,
    fetchConversationAiStatus,
  };
}
