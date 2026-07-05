import { useCallback, useRef } from 'react';

import { chatAPI } from '../../api/client';
import { sortSidebarConversations } from '../../components/chat/chatHelpers';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import { getOrFetchSWR, peekSWRCache } from '../../lib/swrCache';
import { buildChatConversationsCacheKeyParts } from './chatCacheKeys';

const SIDEBAR_LOAD_MORE_THRESHOLD_PX = 240;

export default function useChatConversationsController({
  userCacheId,
  notifyApiError,
  setConversations,
  setConversationsLoading,
  conversationsRequestSeqRef,
  conversationsLoadingRequestSeqRef,
  conversationsLoadingRef,
  conversationsRef,
  conversationsCacheKeyParts,
  conversationsCacheHydratedRef,
  lastConversationsLoadAtRef,
  sidebarScrollRef,
  staleTimeMs = 30_000,
}) {
  const conversationsHasMoreRef = useRef(false);
  const conversationsNextCursorRef = useRef('');
  const conversationsLoadingMoreRef = useRef(false);

  const applyConversationsPayload = useCallback((payload, { preserveSidebarScrollTop = null, append = false } = {}) => {
    conversationsHasMoreRef.current = Boolean(payload?.has_more);
    conversationsNextCursorRef.current = String(payload?.next_cursor || '').trim();
    const incomingItems = sortSidebarConversations(Array.isArray(payload?.items) ? payload.items : []);
    const items = append
      ? sortSidebarConversations([
        ...(Array.isArray(conversationsRef.current) ? conversationsRef.current : []),
        ...incomingItems.filter((item) => !(
          Array.isArray(conversationsRef.current)
          && conversationsRef.current.some((existing) => String(existing?.id || '') === String(item?.id || ''))
        )),
      ])
      : incomingItems;
    lastConversationsLoadAtRef.current = Date.now();
    conversationsCacheHydratedRef.current = true;
    setConversations(items);
    conversationsRef.current = items;
    if (preserveSidebarScrollTop !== null) {
      window.requestAnimationFrame(() => {
        if (sidebarScrollRef.current) {
          sidebarScrollRef.current.scrollTop = preserveSidebarScrollTop;
        }
      });
    }
    return items;
  }, [
    conversationsCacheHydratedRef,
    conversationsRef,
    lastConversationsLoadAtRef,
    setConversations,
    sidebarScrollRef,
  ]);

  const loadConversations = useCallback(async ({ silent = false, force = false, revalidateOnCacheHit = false } = {}) => {
    if (!CHAT_FEATURE_ENABLED) return [];
    const requestSeq = conversationsRequestSeqRef.current + 1;
    conversationsRequestSeqRef.current = requestSeq;
    const cacheKeyParts = conversationsCacheKeyParts || buildChatConversationsCacheKeyParts(userCacheId);
    if (!silent) {
      conversationsLoadingRequestSeqRef.current = requestSeq;
      setConversationsLoading(true);
    } else if (conversationsLoadingRef.current) {
      conversationsLoadingRequestSeqRef.current = requestSeq;
    }
    const sidebarScrollTop = silent ? sidebarScrollRef.current?.scrollTop ?? null : null;
    try {
      const cachedEntry = !silent && !force
        ? peekSWRCache(cacheKeyParts, { staleTimeMs })
        : null;

      if (cachedEntry?.data) {
        if (requestSeq !== conversationsRequestSeqRef.current) return [];
        const cachedItems = applyConversationsPayload(cachedEntry.data, {
          preserveSidebarScrollTop: sidebarScrollTop,
        });
        if (requestSeq === conversationsLoadingRequestSeqRef.current) {
          conversationsLoadingRequestSeqRef.current = 0;
          setConversationsLoading(false);
        }
        if (revalidateOnCacheHit || !cachedEntry.isFresh) {
          void loadConversations({ silent: true, force: true }).catch(() => {});
        }
        return cachedItems;
      }

      const result = await getOrFetchSWR(
        cacheKeyParts,
        () => chatAPI.getConversations({ q: '', limit: 50 }),
        {
          staleTimeMs,
          force,
          revalidateStale: false,
        },
      );
      if (requestSeq !== conversationsRequestSeqRef.current) return [];
      const items = applyConversationsPayload(result.data, {
        preserveSidebarScrollTop: sidebarScrollTop,
      });
      if (result.fromCache && (revalidateOnCacheHit || !result.isFresh) && !force) {
        void loadConversations({ silent: true, force: true }).catch(() => {});
      }
      return items;
    } catch (error) {
      if (!silent) notifyApiError(error, 'Не удалось загрузить список чатов.');
      return [];
    } finally {
      if (requestSeq === conversationsLoadingRequestSeqRef.current) {
        conversationsLoadingRequestSeqRef.current = 0;
        setConversationsLoading(false);
      }
    }
  }, [
    applyConversationsPayload,
    conversationsCacheKeyParts,
    conversationsLoadingRef,
    conversationsLoadingRequestSeqRef,
    conversationsRequestSeqRef,
    notifyApiError,
    setConversationsLoading,
    sidebarScrollRef,
    staleTimeMs,
    userCacheId,
  ]);

  const loadMoreConversations = useCallback(async () => {
    if (!CHAT_FEATURE_ENABLED) return [];
    if (conversationsLoadingMoreRef.current) return conversationsRef.current || [];
    const nextCursor = String(conversationsNextCursorRef.current || '').trim();
    if (!conversationsHasMoreRef.current || !nextCursor) return conversationsRef.current || [];
    conversationsLoadingMoreRef.current = true;
    const sidebarScrollTop = sidebarScrollRef.current?.scrollTop ?? null;
    try {
      const payload = await chatAPI.getConversations({ q: '', limit: 50, cursor: nextCursor });
      return applyConversationsPayload(payload, {
        preserveSidebarScrollTop: sidebarScrollTop,
        append: true,
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить ещё чаты.');
      return conversationsRef.current || [];
    } finally {
      conversationsLoadingMoreRef.current = false;
    }
  }, [applyConversationsPayload, conversationsRef, notifyApiError, sidebarScrollRef]);

  const handleSidebarScroll = useCallback((event) => {
    const node = event?.currentTarget;
    if (!node || !conversationsHasMoreRef.current) return;
    const remaining = Number(node.scrollHeight || 0) - Number(node.scrollTop || 0) - Number(node.clientHeight || 0);
    if (remaining > SIDEBAR_LOAD_MORE_THRESHOLD_PX) return;
    void loadMoreConversations();
  }, [loadMoreConversations]);

  return {
    applyConversationsPayload,
    loadConversations,
    loadMoreConversations,
    handleSidebarScroll,
  };
}
