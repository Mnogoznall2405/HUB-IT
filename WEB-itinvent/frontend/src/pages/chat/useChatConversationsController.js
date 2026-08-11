import { useCallback, useRef } from 'react';

import { chatAPI } from '../../api/client';
import { sortSidebarConversations } from '../../components/chat/chatHelpers';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import { mergeInboxPreviewsIntoConversations } from '../../lib/chatSocket';
import { getOrFetchSWR, peekSWRCache } from '../../lib/swrCache';
import { buildChatConversationsCacheKeyParts } from './chatCacheKeys';
import {
  buildConversationsInFlightKey,
  createKeyedInFlightController,
} from './chatKeyedInFlight';
import { isChatReadConcurrencyFullError } from './chatThreadTransport';
import { emitAgentDebugLog } from '../../lib/debugClientLog';

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
  const conversationsAbortRef = useRef(null);
  const conversationsInFlightRef = useRef(null);
  if (!conversationsInFlightRef.current) {
    conversationsInFlightRef.current = createKeyedInFlightController();
  }

  const applyConversationsPayload = useCallback((payload, {
    preserveSidebarScrollTop = null,
    append = false,
    markAsFresh = true,
  } = {}) => {
    conversationsHasMoreRef.current = Boolean(payload?.has_more);
    conversationsNextCursorRef.current = String(payload?.next_cursor || '').trim();
    const incomingItems = sortSidebarConversations(Array.isArray(payload?.items) ? payload.items : []);
    const mergedIncoming = mergeInboxPreviewsIntoConversations(incomingItems);
    const items = append
      ? sortSidebarConversations(mergeInboxPreviewsIntoConversations([
        ...(Array.isArray(conversationsRef.current) ? conversationsRef.current : []),
        ...mergedIncoming.filter((item) => !(
          Array.isArray(conversationsRef.current)
          && conversationsRef.current.some((existing) => String(existing?.id || '') === String(item?.id || ''))
        )),
      ]))
      : sortSidebarConversations(mergedIncoming);
    // #region agent log
    emitAgentDebugLog({
      runId: 'chat-preview',
      hypothesisId: 'P1',
      location: 'useChatConversationsController.js:applyConversationsPayload',
      message: 'conversations applied with inbox preview merge',
      data: {
        append: !!append,
        incoming: incomingItems.length,
        items: items.length,
        topPreview: String(items[0]?.last_message_preview || '').slice(0, 80),
        topId: String(items[0]?.id || '').slice(0, 40),
      },
    });
    // #endregion
    if (markAsFresh) {
      lastConversationsLoadAtRef.current = Date.now();
    }
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
    const cacheKeyParts = conversationsCacheKeyParts || buildChatConversationsCacheKeyParts(userCacheId);
    const inFlightKey = buildConversationsInFlightKey({
      userCacheId,
      search: '',
      cursor: '',
    });
    return conversationsInFlightRef.current.run(inFlightKey, async ({ isTrailing = false } = {}) => {
      const effectiveForce = Boolean(force || isTrailing);
      const effectiveSilent = Boolean(silent || isTrailing);
      const requestSeq = conversationsRequestSeqRef.current + 1;
      conversationsRequestSeqRef.current = requestSeq;
      // Same-key callers share via keyed in-flight; do not abort the shared request.
      const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      conversationsAbortRef.current = abortController;
      if (!effectiveSilent) {
        conversationsLoadingRequestSeqRef.current = requestSeq;
        setConversationsLoading(true);
      } else if (conversationsLoadingRef.current) {
        conversationsLoadingRequestSeqRef.current = requestSeq;
      }
      const sidebarScrollTop = effectiveSilent ? sidebarScrollRef.current?.scrollTop ?? null : null;
      try {
        const cachedEntry = !effectiveSilent && !effectiveForce
          ? peekSWRCache(cacheKeyParts, { staleTimeMs })
          : null;

        if (cachedEntry?.data) {
          if (requestSeq !== conversationsRequestSeqRef.current) return [];
          const cachedItems = applyConversationsPayload(cachedEntry.data, {
            preserveSidebarScrollTop: sidebarScrollTop,
            markAsFresh: Boolean(cachedEntry.isFresh),
          });
          if (requestSeq === conversationsLoadingRequestSeqRef.current) {
            conversationsLoadingRequestSeqRef.current = 0;
            setConversationsLoading(false);
          }
          if (revalidateOnCacheHit || !cachedEntry.isFresh) {
            conversationsInFlightRef.current.markDirty(inFlightKey);
          }
          return cachedItems;
        }

        const result = await getOrFetchSWR(
          cacheKeyParts,
          () => chatAPI.getConversations({ q: '', limit: 50, signal: abortController?.signal }),
          {
            staleTimeMs,
            force: effectiveForce,
            revalidateStale: false,
          },
        );
        if (requestSeq !== conversationsRequestSeqRef.current) return [];
        const items = applyConversationsPayload(result.data, {
          preserveSidebarScrollTop: sidebarScrollTop,
          markAsFresh: Boolean(!result.fromCache || result.isFresh),
        });
        if (result.fromCache && (revalidateOnCacheHit || !result.isFresh) && !effectiveForce) {
          conversationsInFlightRef.current.markDirty(inFlightKey);
        }
        return items;
      } catch (error) {
        if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED' || error?.name === 'AbortError') {
          return [];
        }
        if (!effectiveSilent) notifyApiError(error, 'Не удалось загрузить список чатов.');
        if (isChatReadConcurrencyFullError(error)) {
          throw error;
        }
        return [];
      } finally {
        if (requestSeq === conversationsLoadingRequestSeqRef.current) {
          conversationsLoadingRequestSeqRef.current = 0;
          setConversationsLoading(false);
        }
      }
    });
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
