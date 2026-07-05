import { useCallback, useEffect, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import { emitAgentDebugLog } from '../../lib/debugClientLog';
import { getOrFetchSWR, peekSWRCache } from '../../lib/swrCache';
import { buildChatThreadCacheKeyParts } from './chatCacheKeys';
import {
  CHAT_THREAD_BOOTSTRAP_LIMIT,
  resolveThreadHasOlderFlag,
  threadFitsSingleBootstrapPage,
} from './chatThreadHistory';
import {
  compareThreadMessagePosition,
  normalizeThreadMessageId,
  reconcileThreadMessages,
  sortThreadMessages,
} from './chatThreadMessages';
import {
  buildCursorInvalidThreadReloadOptions,
  shouldNotifyLoadMessagesError,
} from './chatThreadTransport';

const CHAT_SWR_STALE_TIME_MS = 30_000;

export default function useChatThreadController({
  activeConversationId,
  activeConversationIdRef,
  autoScrollMetaRef,
  autoScrollRef,
  cancelPendingInitialAnchorRef,
  capturePrependScrollRestoreRef,
  conversationsRef,
  hasPendingInitialAnchorForConversationRef,
  hydratedThreadConversationIdRef,
  initialConversationId,
  initialThreadCache,
  isInitialViewportGuardActiveRef,
  loadOlderInFlightCursorRef,
  logChatDebugRef,
  notifyApiError,
  prependScrollRestoreRef,
  resolvePendingInitialAnchorFromPayloadRef,
  scrollThreadBottomIntoViewRef,
  scrollToMessageRef,
  setShowJumpToLatest,
  showJumpToLatestRef,
  syncConversationPreviewRef,
  threadLoadAbortRef,
  threadNearBottomRef,
  threadPrefetchAbortControllersRef,
  userCacheId,
}) {
  const messagesRef = useRef([]);
  const messagesRequestSeqRef = useRef(0);
  const messagesLoadingRequestSeqRef = useRef(0);
  const messagesLoadingRef = useRef(false);
  const messagesHasMoreRef = useRef(false);
  const messagesHasNewerRef = useRef(false);
  const olderHistoryExhaustedRef = useRef(new Map());

  const [messages, setMessages] = useState(() => (
    Array.isArray(initialThreadCache?.data?.items) ? initialThreadCache.data.items : []
  ));
  const [messagesLoading, setMessagesLoading] = useState(() => Boolean(initialConversationId && !initialThreadCache?.data));
  const [messagesHasMore, setMessagesHasMore] = useState(() => {
    const items = initialThreadCache?.data?.items;
    const count = Array.isArray(items) ? items.length : 0;
    const cachedHasMore = Boolean(initialThreadCache?.data?.has_more ?? initialThreadCache?.data?.has_older);
    if (threadFitsSingleBootstrapPage(count)) return false;
    return cachedHasMore;
  });
  const [messagesHasNewer, setMessagesHasNewer] = useState(() => Boolean(initialThreadCache?.data?.has_newer));
  const [olderHistoryUnavailable, setOlderHistoryUnavailable] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewerLastReadMessageId, setViewerLastReadMessageId] = useState(() => String(initialThreadCache?.data?.viewer_last_read_message_id || '').trim());
  const [viewerLastReadAt, setViewerLastReadAt] = useState(() => String(initialThreadCache?.data?.viewer_last_read_at || '').trim());

  messagesRef.current = messages;
  messagesLoadingRef.current = messagesLoading;
  messagesHasMoreRef.current = messagesHasMore;
  messagesHasNewerRef.current = messagesHasNewer;

  const logChatDebug = useCallback((...args) => {
    logChatDebugRef.current?.(...args);
  }, [logChatDebugRef]);

  const isInitialViewportGuardActive = useCallback((conversationId) => (
    typeof isInitialViewportGuardActiveRef.current === 'function'
      ? isInitialViewportGuardActiveRef.current(conversationId)
      : false
  ), [isInitialViewportGuardActiveRef]);

  const hasPendingInitialAnchorForConversation = useCallback((conversationId) => (
    typeof hasPendingInitialAnchorForConversationRef.current === 'function'
      ? hasPendingInitialAnchorForConversationRef.current(conversationId)
      : false
  ), [hasPendingInitialAnchorForConversationRef]);

  const resolvePendingInitialAnchorFromPayload = useCallback((conversationId, payload) => (
    resolvePendingInitialAnchorFromPayloadRef.current?.(conversationId, payload)
  ), [resolvePendingInitialAnchorFromPayloadRef]);

  const capturePrependScrollRestore = useCallback(() => (
    typeof capturePrependScrollRestoreRef.current === 'function'
      ? capturePrependScrollRestoreRef.current()
      : null
  ), [capturePrependScrollRestoreRef]);

  const syncConversationPreview = useCallback((conversationId, lastMessage) => {
    syncConversationPreviewRef.current?.(conversationId, lastMessage);
  }, [syncConversationPreviewRef]);

  const scheduleThreadHydrate = useCallback((conversationId, messageItems, requestSeq) => {
    const id = String(conversationId || '').trim();
    const ids = (Array.isArray(messageItems) ? messageItems : [])
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
    if (!id || !ids.length || typeof chatAPI.hydrateThreadMessages !== 'function') return;
    void chatAPI.hydrateThreadMessages(id, ids)
      .then((data) => {
        if (requestSeq !== messagesRequestSeqRef.current || activeConversationIdRef.current !== id) return;
        const hydrateItems = Array.isArray(data?.items) ? data.items : [];
        if (!hydrateItems.length) return;
        const hydrateMap = new Map(
          hydrateItems.map((item) => [String(item?.message_id || '').trim(), item]),
        );
        setMessages((current) => current.map((message) => {
          const hydrated = hydrateMap.get(String(message?.id || '').trim());
          if (!hydrated) return message;
          const nextReadByCount = Number(hydrated.read_by_count);
          return {
            ...message,
            read_by_count: Number.isFinite(nextReadByCount) ? nextReadByCount : message.read_by_count,
            delivery_status: hydrated.delivery_status ?? message.delivery_status,
            reactions: Array.isArray(hydrated.reactions) ? hydrated.reactions : message.reactions,
          };
        }));
      })
      .catch(() => {});
  }, [activeConversationIdRef]);

  const applyLatestThreadPayload = useCallback((conversationId, payload, { hydrateLatestCache = true } = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return [];
    const olderHistoryExhausted = Boolean(olderHistoryExhaustedRef.current.get(normalizedConversationId));
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const sortedIncoming = sortThreadMessages(items);
    const incomingCount = sortedIncoming.length;
    const incomingFirstMessage = sortedIncoming.at(0) || null;
    hydratedThreadConversationIdRef.current = hydrateLatestCache ? normalizedConversationId : '';

    setViewerLastReadMessageId(String(payload?.viewer_last_read_message_id || '').trim());
    setViewerLastReadAt(String(payload?.viewer_last_read_at || '').trim());

    let preservedOlderCount = 0;
    let nextMessages = items;
    setMessages((current) => {
      const next = reconcileThreadMessages(current, items, {
        conversationId: normalizedConversationId,
        preserveSendingOptimistic: true,
        mode: 'replaceWindowButPreserveFreshLocal',
      });
      preservedOlderCount = next.filter((message) => (
        !items.some((item) => normalizeThreadMessageId(item) === normalizeThreadMessageId(message))
        && compareThreadMessagePosition(message, incomingFirstMessage) < 0
      )).length;
      nextMessages = next;
      if (preservedOlderCount > 0) {
        emitAgentDebugLog({
          location: 'useChatThreadController:applyLatestThreadPayload',
          message: 'preserved loaded older messages during thread revalidate',
          hypothesisId: 'H-HISTORY-WIPE',
          data: {
            conversationId: normalizedConversationId,
            incomingCount: items.length,
            currentCount: current.length,
            nextCount: next.length,
            preservedOlderCount,
          },
        });
      } else if (next.length < current.length) {
        emitAgentDebugLog({
          location: 'useChatThreadController:applyLatestThreadPayload',
          message: 'thread message count decreased during revalidate',
          hypothesisId: 'H-HISTORY-WIPE',
          data: {
            conversationId: normalizedConversationId,
            incomingCount: items.length,
            currentCount: current.length,
            nextCount: next.length,
          },
        });
      }
      return next;
    });

    const payloadHasOlder = Boolean(payload?.has_older ?? payload?.has_more);
    const extendedHistory = nextMessages.length > items.length;
    const resolvedHasOlder = resolveThreadHasOlderFlag({
      payloadHasOlder,
      incomingCount,
      preservedOlderCount,
      olderHistoryExhausted,
      currentHasMore: messagesHasMoreRef.current,
      extendedHistory,
    });
    setMessagesHasMore(resolvedHasOlder);
    if (!resolvedHasOlder) {
      olderHistoryExhaustedRef.current.set(normalizedConversationId, true);
      if (normalizedConversationId === activeConversationIdRef.current) {
        setOlderHistoryUnavailable(true);
      }
    }
    setMessagesHasNewer(Boolean(payload?.has_newer));
    return items;
  }, [activeConversationIdRef, hydratedThreadConversationIdRef]);

  const abortActiveThreadLoad = useCallback(() => {
    const controller = threadLoadAbortRef.current;
    if (!controller) return;
    try {
      controller.abort();
    } catch {
      // Ignore stale abort failures.
    }
    threadLoadAbortRef.current = null;
  }, [threadLoadAbortRef]);

  const queueAutoScroll = useCallback((mode, source, { userInitiated = false } = {}) => {
    const normalizedMode = String(mode || '').trim();
    if (!normalizedMode) {
      autoScrollRef.current = false;
      autoScrollMetaRef.current = null;
      return false;
    }
    const normalizedConversationId = String(activeConversationIdRef.current || '').trim();
    if (!userInitiated && isInitialViewportGuardActive(normalizedConversationId)) {
      logChatDebug('autoScroll:blocked', {
        conversationId: normalizedConversationId,
        mode: normalizedMode,
        source,
      });
      return false;
    }
    autoScrollRef.current = normalizedMode;
    autoScrollMetaRef.current = {
      source: String(source || '').trim() || 'unknown',
      userInitiated,
      requestedAt: Date.now(),
    };
    logChatDebug('autoScroll:queued', {
      conversationId: normalizedConversationId,
      mode: normalizedMode,
      source,
      userInitiated,
    });
    emitAgentDebugLog({
      location: 'useChatThreadController:queueAutoScroll',
      message: 'autoScroll queued',
      data: { mode: normalizedMode, source: String(source || ''), userInitiated: Boolean(userInitiated) },
      hypothesisId: 'H1',
    });
    return true;
  }, [activeConversationIdRef, autoScrollMetaRef, autoScrollRef, isInitialViewportGuardActive, logChatDebug]);

  const loadThreadBootstrap = useCallback(async (conversationId, {
    silent = false,
    reason = 'thread-bootstrap',
    force = false,
  } = {}) => {
    const id = String(conversationId || '').trim();
    if (!CHAT_FEATURE_ENABLED || !id) {
      hydratedThreadConversationIdRef.current = '';
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      return [];
    }

    abortActiveThreadLoad();
    if (!silent) {
      messagesLoadingRequestSeqRef.current = messagesRequestSeqRef.current + 1;
      setMessagesLoading(true);
    } else if (messagesLoadingRef.current) {
      messagesLoadingRequestSeqRef.current = messagesRequestSeqRef.current + 1;
    }

    const requestSeq = messagesRequestSeqRef.current + 1;
    messagesRequestSeqRef.current = requestSeq;
    logChatDebug('loadThreadBootstrap:start', {
      conversationId: id,
      reason,
      requestSeq,
      silent,
      force,
    });

    try {
      const cacheKeyParts = buildChatThreadCacheKeyParts(userCacheId, id);
      const cachedEntry = !silent && !force
        ? peekSWRCache(cacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS })
        : null;

      if (cachedEntry?.data) {
        if (requestSeq !== messagesRequestSeqRef.current || activeConversationIdRef.current !== id) {
          return [];
        }
        const cachedItems = applyLatestThreadPayload(id, cachedEntry.data);
        scheduleThreadHydrate(id, cachedItems, requestSeq);
        resolvePendingInitialAnchorFromPayload(id, cachedEntry.data);
        if (requestSeq === messagesLoadingRequestSeqRef.current) {
          messagesLoadingRequestSeqRef.current = 0;
          setMessagesLoading(false);
        }
        if (!cachedEntry.isFresh) {
          void loadThreadBootstrap(id, {
            silent: true,
            reason: `${reason}:revalidate`,
            force: true,
          }).catch(() => {});
        }
        return cachedItems;
      }

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      threadLoadAbortRef.current = controller;
      const result = await getOrFetchSWR(
        cacheKeyParts,
        () => (typeof chatAPI.getThreadBootstrap === 'function'
          ? chatAPI.getThreadBootstrap(
              id,
              { limit: CHAT_THREAD_BOOTSTRAP_LIMIT, lightweight: 1 },
              { signal: controller?.signal },
            )
          : chatAPI.getMessages(
              id,
              { limit: CHAT_THREAD_BOOTSTRAP_LIMIT },
              { signal: controller?.signal },
            )),
        {
          staleTimeMs: CHAT_SWR_STALE_TIME_MS,
          force,
          revalidateStale: false,
        },
      );
      if (controller && threadLoadAbortRef.current === controller) {
        threadLoadAbortRef.current = null;
      }
      if (requestSeq !== messagesRequestSeqRef.current || activeConversationIdRef.current !== id) {
        return [];
      }

      const data = result?.data || {};
      resolvePendingInitialAnchorFromPayload(id, data);
      applyLatestThreadPayload(id, data);
      scheduleThreadHydrate(id, data.items, requestSeq);
      return Array.isArray(data?.items) ? data.items : [];
    } catch (error) {
      if (String(error?.code || '') !== 'ERR_CANCELED' && String(error?.name || '') !== 'CanceledError') {
        logChatDebug('loadThreadBootstrap:error', {
          conversationId: id,
          reason,
          requestSeq,
          error: String(error?.message || error),
        });
        if (!silent) notifyApiError(error, 'Не удалось открыть чат.');
      }
      return [];
    } finally {
      if (requestSeq === messagesLoadingRequestSeqRef.current) {
        messagesLoadingRequestSeqRef.current = 0;
        setMessagesLoading(false);
      }
    }
  }, [abortActiveThreadLoad, activeConversationIdRef, applyLatestThreadPayload, hydratedThreadConversationIdRef, logChatDebug, notifyApiError, resolvePendingInitialAnchorFromPayload, scheduleThreadHydrate, threadLoadAbortRef, userCacheId]);

  const loadMessages = useCallback(async (conversationId, {
    silent = false,
    beforeMessageId = '',
    afterMessageId = '',
    reason = 'unspecified',
    force = false,
  } = {}) => {
    const id = String(conversationId || '').trim();
    const beforeId = String(beforeMessageId || '').trim();
    const afterId = String(afterMessageId || '').trim();
    if (!CHAT_FEATURE_ENABLED || !id) {
      hydratedThreadConversationIdRef.current = '';
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      return [];
    }

    if (!beforeId && !afterId) {
      return loadThreadBootstrap(id, { silent, reason, force });
    }

    const loadingOlderRequest = Boolean(beforeId);
    const loadingNewerRequest = Boolean(afterId);
    if (loadingOlderRequest) {
      setLoadingOlder(true);
      prependScrollRestoreRef.current = capturePrependScrollRestore();
    } else if (!silent) {
      messagesLoadingRequestSeqRef.current = messagesRequestSeqRef.current + 1;
      setMessagesLoading(true);
    }

    const requestSeq = loadingOlderRequest
      ? messagesRequestSeqRef.current
      : messagesRequestSeqRef.current + 1;
    if (!loadingOlderRequest) {
      messagesRequestSeqRef.current = requestSeq;
    }
    logChatDebug('loadMessages:start', {
      conversationId: id,
      reason,
      requestSeq,
      silent,
      beforeMessageId: beforeId || null,
      afterMessageId: afterId || null,
      loadingOlderRequest,
      loadingNewerRequest,
    });
    if (!loadingOlderRequest && silent && messagesLoadingRef.current) {
      messagesLoadingRequestSeqRef.current = requestSeq;
    }
    const previousLastMessage = !loadingOlderRequest && !loadingNewerRequest && activeConversationIdRef.current === id
      ? messagesRef.current[messagesRef.current.length - 1]
      : null;
    const previousConversation = conversationsRef.current.find((item) => item.id === id) || null;
    const shouldStickToBottom = threadNearBottomRef.current;
    const initialAnchorPending = hasPendingInitialAnchorForConversation(id);

    try {
      const latestThreadCacheKeyParts = buildChatThreadCacheKeyParts(userCacheId, id);
      const cachedEntry = !loadingOlderRequest && !loadingNewerRequest && !silent && !force
        ? peekSWRCache(latestThreadCacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS })
        : null;

      if (cachedEntry?.data) {
        if (requestSeq !== messagesRequestSeqRef.current || activeConversationIdRef.current !== id) {
          return [];
        }
        const cachedItems = applyLatestThreadPayload(id, cachedEntry.data);
        resolvePendingInitialAnchorFromPayload(id, cachedEntry.data);
        if (requestSeq === messagesLoadingRequestSeqRef.current) {
          messagesLoadingRequestSeqRef.current = 0;
          setMessagesLoading(false);
        }
        if (!cachedEntry.isFresh) {
          void loadMessages(id, {
            silent: true,
            reason: `${reason}:revalidate`,
            force: true,
          }).catch(() => {});
        }
        return cachedItems;
      }

      const data = loadingOlderRequest || loadingNewerRequest
        ? await chatAPI.getMessages(id, {
            limit: 50,
            before_message_id: beforeId || undefined,
            after_message_id: afterId || undefined,
          })
        : (await getOrFetchSWR(
            latestThreadCacheKeyParts,
            () => chatAPI.getMessages(id, {
              limit: 100,
            }),
            {
              staleTimeMs: CHAT_SWR_STALE_TIME_MS,
              force,
              revalidateStale: false,
            },
          )).data;

      if (activeConversationIdRef.current !== id) {
        logChatDebug('loadMessages:stale', {
          conversationId: id,
          reason,
          requestSeq,
          latestRequestSeq: messagesRequestSeqRef.current,
          activeConversationId: activeConversationIdRef.current,
          loadingOlderRequest,
        });
        if (loadingOlderRequest) {
          prependScrollRestoreRef.current = null;
        }
        return [];
      }
      if (!loadingOlderRequest && requestSeq !== messagesRequestSeqRef.current) {
        logChatDebug('loadMessages:stale', {
          conversationId: id,
          reason,
          requestSeq,
          latestRequestSeq: messagesRequestSeqRef.current,
          activeConversationId: activeConversationIdRef.current,
          loadingOlderRequest,
        });
        return [];
      }

      const cursorInvalid = Boolean(data?.cursor_invalid);
      if (cursorInvalid) {
        logChatDebug('loadMessages:cursor_invalid', {
          conversationId: id,
          reason,
          requestSeq,
          beforeMessageId: beforeId || null,
          afterMessageId: afterId || null,
          loadingOlderRequest,
          loadingNewerRequest,
        });
        if (loadingOlderRequest) {
          if (requestSeq === messagesRequestSeqRef.current && activeConversationIdRef.current === id) {
            setLoadingOlder(false);
          }
        } else if (requestSeq === messagesLoadingRequestSeqRef.current) {
          messagesLoadingRequestSeqRef.current = 0;
          setMessagesLoading(false);
        }
        if (activeConversationIdRef.current === id) {
          const reloadOptions = buildCursorInvalidThreadReloadOptions(reason);
          void loadThreadBootstrap(id, reloadOptions).catch(() => {});
        }
        return [];
      }

      const items = Array.isArray(data?.items) ? data.items : [];
      const hasOlder = Boolean(data?.has_older ?? data?.has_more);
      const hasNewer = Boolean(data?.has_newer);

      if (loadingOlderRequest) {
        const seen = new Set(messagesRef.current.map((item) => item.id));
        const older = items.filter((item) => !seen.has(item.id));
        const appendedCount = older.length;
        emitAgentDebugLog({
          location: 'useChatThreadController:loadMessages:prependOlder',
          message: 'load older prepend evaluated',
          hypothesisId: 'H-HISTORY-WIPE',
          data: {
            conversationId: id,
            reason,
            apiItemsCount: items.length,
            appendedCount,
            hasOlder,
            beforeMessageId: beforeId || null,
          },
        });
        if (appendedCount === 0) {
          prependScrollRestoreRef.current = null;
          olderHistoryExhaustedRef.current.set(id, true);
          setMessagesHasMore(false);
          if (id === activeConversationIdRef.current) {
            setOlderHistoryUnavailable(true);
          }
        } else {
          setMessagesHasMore(hasOlder);
          setMessagesHasNewer((current) => current || hasNewer);
          setMessages((current) => [...older, ...current]);
        }
        return items;
      }

      if (loadingNewerRequest) {
        setMessagesHasMore((current) => current || hasOlder);
        setMessagesHasNewer(hasNewer);
        setMessages((current) => {
          const seen = new Set(current.map((item) => item.id));
          const newer = items.filter((item) => !seen.has(item.id));
          if (newer.length === 0) return current;
          return [...current, ...newer];
        });
        return items;
      }

      const last = items[items.length - 1];
      const previousLastId = String(previousLastMessage?.id || '').trim();
      const nextLastId = String(last?.id || '').trim();
      const previousHadConversationMessage = Boolean(previousConversation?.last_message_at || previousConversation?.last_message_preview);
      const lastMessageChanged = Boolean(nextLastId) && Boolean(previousLastId) && previousLastId !== nextLastId;
      const firstConversationMessageArrived = Boolean(nextLastId) && !previousLastId && !previousHadConversationMessage;
      const nextViewerLastReadMessageId = String(data?.viewer_last_read_message_id || '').trim();
      if (!loadingOlderRequest && !loadingNewerRequest) {
        resolvePendingInitialAnchorFromPayload(id, {
          items,
          viewer_last_read_message_id: nextViewerLastReadMessageId,
          viewer_last_read_at: String(data?.viewer_last_read_at || '').trim(),
        });
      }

      applyLatestThreadPayload(id, {
        items,
        has_more: hasOlder,
        has_older: hasOlder,
        has_newer: hasNewer,
        viewer_last_read_message_id: nextViewerLastReadMessageId,
        viewer_last_read_at: String(data?.viewer_last_read_at || '').trim(),
      });

      if ((lastMessageChanged || firstConversationMessageArrived) && shouldStickToBottom && !initialAnchorPending) {
        queueAutoScroll('bottom_instant', 'loadMessages:latest_payload');
      }

      logChatDebug('loadMessages:success', {
        conversationId: id,
        reason,
        requestSeq,
        itemsCount: items.length,
        hasOlder,
        hasNewer,
        lastMessageId: String(last?.id || '').trim(),
        viewerLastReadMessageId: nextViewerLastReadMessageId,
        shouldStickToBottom,
        initialAnchorPending,
      });

      if (last?.id) {
        syncConversationPreview(id, last);
      }

      return items;
    } catch (error) {
      logChatDebug('loadMessages:error', {
        conversationId: id,
        reason,
        requestSeq,
        error: String(error?.message || error),
      });
      const notifyLoadError = shouldNotifyLoadMessagesError({
        silent,
        reason,
        error,
        loadingOlderRequest,
        loadingNewerRequest,
      });
      emitAgentDebugLog({
        location: 'useChatThreadController:loadMessages',
        message: notifyLoadError ? 'loadMessages error toast shown' : 'loadMessages error suppressed',
        hypothesisId: 'H-502',
        data: {
          reason,
          silent,
          loadingOlderRequest,
          loadingNewerRequest,
          status: Number(error?.response?.status || 0),
          notifyLoadError,
        },
      });
      if (notifyLoadError) {
        notifyApiError(error, loadingOlderRequest ? 'Не удалось загрузить более ранние сообщения.' : 'Не удалось загрузить сообщения чата.');
      }
      return [];
    } finally {
      if (loadingOlderRequest) {
        if (activeConversationIdRef.current === id) setLoadingOlder(false);
      } else if (requestSeq === messagesLoadingRequestSeqRef.current) {
        messagesLoadingRequestSeqRef.current = 0;
        setMessagesLoading(false);
      }
    }
  }, [
    activeConversationIdRef,
    applyLatestThreadPayload,
    capturePrependScrollRestore,
    conversationsRef,
    hasPendingInitialAnchorForConversation,
    hydratedThreadConversationIdRef,
    loadThreadBootstrap,
    logChatDebug,
    notifyApiError,
    prependScrollRestoreRef,
    queueAutoScroll,
    resolvePendingInitialAnchorFromPayload,
    syncConversationPreview,
    threadNearBottomRef,
    userCacheId,
  ]);

  const loadOlderMessages = useCallback(async () => {
    const firstMessageId = String(messagesRef.current[0]?.id || '').trim();
    const conversationId = String(activeConversationId || '').trim();
    if (!conversationId || !firstMessageId || loadingOlder || !messagesHasMore) return;
    if (olderHistoryExhaustedRef.current.get(conversationId)) return;
    if (threadFitsSingleBootstrapPage(messagesRef.current.length)) return;
    const cursorKey = `${conversationId}:${firstMessageId}`;
    if (loadOlderInFlightCursorRef.current === cursorKey) return;
    loadOlderInFlightCursorRef.current = cursorKey;
    emitAgentDebugLog({
      location: 'useChatThreadController:loadOlderMessages',
      message: 'load older history requested',
      hypothesisId: 'H-HISTORY-WIPE',
      data: {
        conversationId,
        firstMessageId,
        currentCount: messagesRef.current.length,
      },
    });
    try {
      await loadMessages(conversationId, {
        silent: true,
        beforeMessageId: firstMessageId,
        reason: 'loadOlderMessages',
      });
    } finally {
      if (loadOlderInFlightCursorRef.current === cursorKey) {
        loadOlderInFlightCursorRef.current = '';
      }
    }
  }, [activeConversationId, loadMessages, loadOlderInFlightCursorRef, loadingOlder, messagesHasMore]);

  useEffect(() => () => {
    abortActiveThreadLoad();
  }, [abortActiveThreadLoad]);

  return {
    messages,
    setMessages,
    messagesRef,
    messagesLoading,
    setMessagesLoading,
    messagesLoadingRef,
    messagesRequestSeqRef,
    messagesLoadingRequestSeqRef,
    messagesHasMore,
    setMessagesHasMore,
    messagesHasMoreRef,
    messagesHasNewer,
    setMessagesHasNewer,
    messagesHasNewerRef,
    olderHistoryUnavailable,
    setOlderHistoryUnavailable,
    olderHistoryExhaustedRef,
    loadingOlder,
    setLoadingOlder,
    viewerLastReadMessageId,
    setViewerLastReadMessageId,
    viewerLastReadAt,
    setViewerLastReadAt,
    applyLatestThreadPayload,
    loadThreadBootstrap,
    loadMessages,
    loadOlderMessages,
    queueAutoScroll,
    abortActiveThreadLoad,
  };
}
