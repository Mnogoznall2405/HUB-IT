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
  isFailedOptimisticThreadMessage,
  normalizeThreadMessageId,
  reconcileThreadMessages,
  sortThreadMessages,
} from './chatThreadMessages';
import {
  buildActiveThreadPollLoadOptions,
  buildCursorInvalidThreadReloadOptions,
  isChatReadConcurrencyFullError,
  isTransientLoadMessagesError,
  resolveChatReadRetryAfterMs,
  shouldNotifyLoadMessagesError,
} from './chatThreadTransport';
import {
  collectPersistedThreadClientIds,
  pruneFailedThreadMessagesRegistry,
  upsertThreadMessagesInList,
} from './chatThreadMessageMerge';
import { withStableThreadMessageRenderKey } from './chatOptimisticMessages';
import {
  buildHistoryInFlightKey,
  createKeyedInFlightController,
} from './chatKeyedInFlight';

const CHAT_SWR_STALE_TIME_MS = 30_000;
export const CHAT_THREAD_LOAD_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const CHAT_THREAD_LOAD_RETRY_JITTER = 0.2;

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
  loadMessagesRef,
  failedThreadMessagesRef,
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
  const loadingNewerRef = useRef(false);
  const olderHistoryExhaustedRef = useRef(new Map());
  const historyInFlightRef = useRef(null);
  if (!historyInFlightRef.current) {
    historyInFlightRef.current = createKeyedInFlightController();
  }
  const historyInFlightConversationRef = useRef('');

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
  const [threadLoadError, setThreadLoadError] = useState(null);
  const threadLoadRetryRef = useRef({ conversationId: '', attempt: 0, timerId: 0 });
  const loadThreadBootstrapRef = useRef(null);

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

  const clearThreadLoadRetry = useCallback(() => {
    const retry = threadLoadRetryRef.current;
    if (retry.timerId) {
      window.clearTimeout(retry.timerId);
      retry.timerId = 0;
    }
    retry.attempt = 0;
    retry.conversationId = '';
  }, []);

  const scheduleThreadLoadRetry = useCallback((conversationId, error) => {
    const id = String(conversationId || '').trim();
    if (!id) return;
    // Nothing to retry when the thread already has content on screen; silent
    // revalidate failures for hydrated threads keep their existing behaviour.
    if (String(hydratedThreadConversationIdRef.current || '').trim() === id) return;
    const retry = threadLoadRetryRef.current;
    if (retry.conversationId !== id) {
      retry.conversationId = id;
      retry.attempt = 0;
    }
    const concurrencyFull = isChatReadConcurrencyFullError(error);
    const transient = isTransientLoadMessagesError(error);
    if ((!transient && !concurrencyFull) || retry.attempt >= CHAT_THREAD_LOAD_RETRY_DELAYS_MS.length) {
      setThreadLoadError({ conversationId: id });
      return false;
    }
    let delayMs = CHAT_THREAD_LOAD_RETRY_DELAYS_MS[retry.attempt];
    if (concurrencyFull) {
      delayMs = Math.max(delayMs, resolveChatReadRetryAfterMs(error, { attempt: retry.attempt }));
    }
    retry.attempt += 1;
    const jittered = Math.round(delayMs * (1 + (Math.random() * 2 - 1) * CHAT_THREAD_LOAD_RETRY_JITTER));
    window.clearTimeout(retry.timerId);
    retry.timerId = window.setTimeout(() => {
      retry.timerId = 0;
      if (String(activeConversationIdRef.current || '').trim() !== id) return;
      void loadThreadBootstrapRef.current?.(id, {
        silent: true,
        force: true,
        reason: 'thread-bootstrap:retry',
      });
    }, Math.max(250, jittered));
    return true;
  }, [activeConversationIdRef, hydratedThreadConversationIdRef]);

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
    setThreadLoadError((current) => (current?.conversationId === normalizedConversationId ? null : current));

    let preservedOlderCount = 0;
    let nextMessages = items;
    setMessages((current) => {
      // R4: failed outgoing bubbles live in a page-level ref so they survive
      // conversation switches — a cold/cached reload wipes `current`, so
      // merge them back here and let reconcile dedup by client_message_id.
      let base = current;
      const failedForConversation = failedThreadMessagesRef?.current?.get?.(normalizedConversationId);
      if (failedForConversation?.size) {
        // R12: only persisted items prove the message reached the server —
        // optimistic bubbles may arrive via the SWR thread cache and must not
        // be counted, otherwise the failed registry entry is dropped and
        // "Повторить" has nothing to retry.
        // The server copy may already sit in `current` (ACK / socket / newer
        // page) while this payload predates it — it proves delivery too.
        const persistedClientIds = collectPersistedThreadClientIds(items);
        collectPersistedThreadClientIds(current.filter((item) => (
          String(item?.conversation_id || '').trim() === normalizedConversationId
        ))).forEach((clientId) => persistedClientIds.add(clientId));
        pruneFailedThreadMessagesRegistry(
          failedThreadMessagesRef.current,
          normalizedConversationId,
          persistedClientIds,
        );
        const failedToRestore = [];
        failedForConversation.forEach((entry) => {
          const failedMessage = entry?.message;
          if (
            failedMessage?.id
            && isFailedOptimisticThreadMessage(failedMessage, normalizedConversationId)
            && !current.some((item) => normalizeThreadMessageId(item) === normalizeThreadMessageId(failedMessage))
          ) {
            failedToRestore.push(failedMessage);
          }
        });
        if (failedToRestore.length) {
          base = [...current, ...failedToRestore];
        }
      }
      const next = reconcileThreadMessages(base, items, {
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
  }, [activeConversationIdRef, failedThreadMessagesRef, hydratedThreadConversationIdRef]);

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
      setThreadLoadError(null);
      clearThreadLoadRetry();
      return [];
    }

    const inFlightKey = buildHistoryInFlightKey({
      conversationId: id,
      cursor: '',
      direction: 'latest',
      limit: CHAT_THREAD_BOOTSTRAP_LIMIT,
    });
    // Abort only when switching conversations; same-key callers share in-flight.
    if (historyInFlightConversationRef.current && historyInFlightConversationRef.current !== id) {
      abortActiveThreadLoad();
      clearThreadLoadRetry();
    }
    historyInFlightConversationRef.current = id;

    return historyInFlightRef.current.run(inFlightKey, async ({ isTrailing = false } = {}) => {
      const effectiveForce = Boolean(force || isTrailing);
      const effectiveSilent = Boolean(silent || isTrailing);
      if (!effectiveSilent) {
        messagesLoadingRequestSeqRef.current = messagesRequestSeqRef.current + 1;
        setMessagesLoading(true);
        threadLoadRetryRef.current.attempt = 0;
        setThreadLoadError(null);
      } else if (messagesLoadingRef.current) {
        messagesLoadingRequestSeqRef.current = messagesRequestSeqRef.current + 1;
      }

      const requestSeq = messagesRequestSeqRef.current + 1;
      messagesRequestSeqRef.current = requestSeq;
      logChatDebug('loadThreadBootstrap:start', {
        conversationId: id,
        reason: isTrailing ? `${reason}:trailing` : reason,
        requestSeq,
        silent: effectiveSilent,
        force: effectiveForce,
      });

      let threadLoadRetryScheduled = false;
      try {
        const cacheKeyParts = buildChatThreadCacheKeyParts(userCacheId, id);
        const cachedEntry = !effectiveSilent && !effectiveForce
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
            historyInFlightRef.current.markDirty(inFlightKey);
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
            force: effectiveForce,
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
        if (result?.fromCache && !result?.isFresh && !effectiveForce) {
          historyInFlightRef.current.markDirty(inFlightKey);
        }
        return Array.isArray(data?.items) ? data.items : [];
      } catch (error) {
        const requestCanceled = String(error?.code || '') === 'ERR_CANCELED' || String(error?.name || '') === 'CanceledError';
        if (!requestCanceled) {
          logChatDebug('loadThreadBootstrap:error', {
            conversationId: id,
            reason,
            requestSeq,
            error: String(error?.message || error),
          });
          if (!effectiveSilent) notifyApiError(error, 'Не удалось открыть чат.');
          if (
            requestSeq === messagesRequestSeqRef.current
            && String(activeConversationIdRef.current || '').trim() === id
          ) {
            threadLoadRetryScheduled = scheduleThreadLoadRetry(id, error) === true;
          }
        }
        return [];
      } finally {
        if (!threadLoadRetryScheduled && requestSeq === messagesLoadingRequestSeqRef.current) {
          messagesLoadingRequestSeqRef.current = 0;
          setMessagesLoading(false);
        }
      }
    });
  }, [abortActiveThreadLoad, activeConversationIdRef, applyLatestThreadPayload, clearThreadLoadRetry, hydratedThreadConversationIdRef, logChatDebug, notifyApiError, resolvePendingInitialAnchorFromPayload, scheduleThreadHydrate, scheduleThreadLoadRetry, threadLoadAbortRef, userCacheId]);
  loadThreadBootstrapRef.current = loadThreadBootstrap;

  const retryThreadLoad = useCallback(() => {
    const id = String(activeConversationIdRef.current || '').trim();
    if (!id) return [];
    clearThreadLoadRetry();
    setThreadLoadError(null);
    return loadThreadBootstrap(id, { force: true, reason: 'thread-load:manual-retry' });
  }, [activeConversationIdRef, clearThreadLoadRetry, loadThreadBootstrap]);

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
    const historyLimit = 50;
    const inFlightKey = buildHistoryInFlightKey({
      conversationId: id,
      cursor: beforeId || afterId || '',
      direction: loadingOlderRequest ? 'before' : 'after',
      limit: historyLimit,
    });

    return historyInFlightRef.current.run(inFlightKey, async ({ isTrailing = false } = {}) => {
    const effectiveForce = Boolean(force || isTrailing);
    const effectiveSilent = Boolean(silent || isTrailing);
    if (loadingOlderRequest) {
      setLoadingOlder(true);
      prependScrollRestoreRef.current = capturePrependScrollRestore();
    } else if (!effectiveSilent) {
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
      reason: isTrailing ? `${reason}:trailing` : reason,
      requestSeq,
      silent: effectiveSilent,
      beforeMessageId: beforeId || null,
      afterMessageId: afterId || null,
      loadingOlderRequest,
      loadingNewerRequest,
    });
    if (!loadingOlderRequest && effectiveSilent && messagesLoadingRef.current) {
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
      const cachedEntry = !loadingOlderRequest && !loadingNewerRequest && !effectiveSilent && !effectiveForce
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
          historyInFlightRef.current.markDirty(inFlightKey);
        }
        return cachedItems;
      }

      const data = loadingOlderRequest || loadingNewerRequest
        ? await chatAPI.getMessages(id, {
            limit: historyLimit,
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
              force: effectiveForce,
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
          // A newer page may carry the server copy of a local sending/failed
          // bubble: merge it by client_message_id instead of appending a
          // second row (upsert also keeps the list ordered).
          return upsertThreadMessagesInList(current, newer, {
            activeConversationId: id,
            withStableMessageRenderKey: withStableThreadMessageRenderKey,
          });
        });
        pruneFailedThreadMessagesRegistry(
          failedThreadMessagesRef?.current,
          id,
          collectPersistedThreadClientIds(items),
        );
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
        silent: effectiveSilent,
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
          silent: effectiveSilent,
          loadingOlderRequest,
          loadingNewerRequest,
          status: Number(error?.response?.status || 0),
          notifyLoadError,
        },
      });
      if (notifyLoadError) {
        notifyApiError(error, loadingOlderRequest ? 'Не удалось загрузить более ранние сообщения.' : 'Не удалось загрузить сообщения чата.');
      }
      // Propagate admission-control errors so pollers can honour Retry-After / backoff.
      if (isChatReadConcurrencyFullError(error)) {
        throw error;
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
    });
  }, [
    activeConversationIdRef,
    applyLatestThreadPayload,
    capturePrependScrollRestore,
    conversationsRef,
    failedThreadMessagesRef,
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

  // R2: shared ref must point at the real loader — polling, socket events and
  // panel controllers call it without the function in scope.
  useEffect(() => {
    if (!loadMessagesRef) return;
    loadMessagesRef.current = loadMessages;
  }, [loadMessages, loadMessagesRef]);

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

  // R19: approaching the bottom of a partial window (has_newer) loads the next
  // page after the last persisted message. One request in flight; appending
  // below the viewport keeps scrollTop untouched — no visible jump.
  const loadNewerMessages = useCallback(async () => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId || !messagesHasNewerRef.current) return;
    if (loadingNewerRef.current) return;
    const requestOptions = buildActiveThreadPollLoadOptions(messagesRef.current);
    if (!requestOptions.afterMessageId) return;
    loadingNewerRef.current = true;
    logChatDebug('loadNewerMessages:start', {
      conversationId,
      afterMessageId: requestOptions.afterMessageId,
    });
    try {
      await loadMessages(conversationId, {
        ...requestOptions,
        reason: 'loadNewerMessages',
      });
    } catch {
      // Silent page-down failures stay quiet — the next approach retries.
    } finally {
      loadingNewerRef.current = false;
    }
  }, [activeConversationIdRef, loadMessages, logChatDebug]);

  useEffect(() => () => {
    abortActiveThreadLoad();
    clearThreadLoadRetry();
  }, [abortActiveThreadLoad, clearThreadLoadRetry]);

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
    loadNewerMessages,
    loadOlderMessages,
    retryThreadLoad,
    threadLoadError,
    queueAutoScroll,
    abortActiveThreadLoad,
  };
}
