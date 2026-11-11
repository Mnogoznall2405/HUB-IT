import { useCallback, useEffect, useRef } from 'react';

import {
  INITIAL_THREAD_AUTOSCROLL_GUARD_MS,
  INITIAL_THREAD_POSITION_MAX_MS,
  INITIAL_THREAD_POSITION_SETTLE_MS,
  INITIAL_THREAD_SCROLL_TRACE_WINDOW_MS,
  computePendingInitialAnchorScrollTop,
  getInitialScrollMode,
  isPendingAnchorScrollUnchanged,
  resolveInitialAnchorState,
  resolvePendingAnchorFieldsFromPayload,
} from './chatAnchorModel';
import { getUnreadAnchorId } from '../../components/chat/chatHelpers';

const CHAT_SCROLL_DEBUG_STORAGE_KEY = 'chat:scroll-debug';

/**
 * Initial thread anchor positioning and viewport guard orchestration.
 * ChatPageContent still owns layout-effect autoScroll vs pendingAnchor priority.
 */
export default function useChatAnchorController({
  activeConversationId,
  activeConversationIdRef,
  autoScrollMetaRef,
  autoScrollRef,
  conversationsRef,
  initialViewportGuardRef,
  logChatDebug,
  messagesRef,
  pendingInitialAnchorRef,
  prependScrollRestoreRef,
  setShowJumpToLatest,
  setThreadScrollTop,
  showJumpToLatestRef,
  syncThreadViewportState,
  threadContentRef,
  threadNearBottomRef,
  threadScrollRef,
  viewerLastReadMessageId,
}) {
  const pendingInitialAnchorSettleTimeoutRef = useRef(null);
  const pendingInitialAnchorRetryTimeoutRef = useRef(null);
  const pendingInitialAnchorResizeFrameRef = useRef(null);
  const initialViewportGuardTimeoutRef = useRef(null);
  const programmaticScrollHistoryRef = useRef([]);
  const bufferedAnchorPayloadRef = useRef(null);

  const setThreadOverflowAnchorMode = useCallback((mode = '') => {
    const container = threadScrollRef.current;
    if (!container?.style) return;
    container.style.overflowAnchor = String(mode || '').trim();
  }, [threadScrollRef]);

  const isChatScrollTraceEnabled = useCallback(() => {
    try {
      return window.localStorage.getItem(CHAT_SCROLL_DEBUG_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }, []);

  const clearInitialViewportGuard = useCallback((reason = 'clear') => {
    if (initialViewportGuardTimeoutRef.current) {
      window.clearTimeout(initialViewportGuardTimeoutRef.current);
      initialViewportGuardTimeoutRef.current = null;
    }
    const guard = initialViewportGuardRef.current;
    if (guard) {
      logChatDebug('initialViewportGuard:clear', {
        conversationId: guard.conversationId,
        mode: guard.mode,
        reason,
        correctionCount: Number(guard.correctionCount || 0),
        scrollOpsWithin200ms: Number(guard.scrollOpsWithin200ms || 0),
      });
    }
    initialViewportGuardRef.current = null;
    programmaticScrollHistoryRef.current = [];
    setThreadOverflowAnchorMode('');
  }, [logChatDebug, setThreadOverflowAnchorMode]);

  const isInitialViewportGuardActive = useCallback((conversationId = activeConversationIdRef.current) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const guard = initialViewportGuardRef.current;
    if (!normalizedConversationId || !guard || guard.conversationId !== normalizedConversationId) return false;
    if (Date.now() > Number(guard.releaseAt || 0)) {
      clearInitialViewportGuard('expired');
      return false;
    }
    return true;
  }, [activeConversationIdRef, clearInitialViewportGuard]);

  const beginInitialViewportGuard = useCallback((conversationId, mode) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) {
      clearInitialViewportGuard('missing_conversation');
      return null;
    }
    if (initialViewportGuardTimeoutRef.current) {
      window.clearTimeout(initialViewportGuardTimeoutRef.current);
      initialViewportGuardTimeoutRef.current = null;
    }
    const now = Date.now();
    initialViewportGuardRef.current = {
      conversationId: normalizedConversationId,
      mode: String(mode || '').trim() || 'bottom_instant',
      startedAt: now,
      releaseAt: now + INITIAL_THREAD_AUTOSCROLL_GUARD_MS,
      correctionCount: 0,
      lastObservedScrollHeight: -1,
      scrollOpsWithin200ms: 0,
    };
    programmaticScrollHistoryRef.current = [];
    setThreadOverflowAnchorMode('none');
    initialViewportGuardTimeoutRef.current = window.setTimeout(() => {
      const currentGuard = initialViewportGuardRef.current;
      if (!currentGuard || currentGuard.conversationId !== normalizedConversationId) return;
      clearInitialViewportGuard('timeout');
    }, INITIAL_THREAD_AUTOSCROLL_GUARD_MS);
    logChatDebug('initialViewportGuard:start', {
      conversationId: normalizedConversationId,
      mode,
      releaseInMs: INITIAL_THREAD_AUTOSCROLL_GUARD_MS,
    });
    return initialViewportGuardRef.current;
  }, [clearInitialViewportGuard, logChatDebug, setThreadOverflowAnchorMode]);

  const traceProgrammaticThreadScroll = useCallback((source, details = {}) => {
    const now = Date.now();
    const nextSource = String(source || '').trim() || 'unknown';
    const guard = initialViewportGuardRef.current;
    const recentHistory = (Array.isArray(programmaticScrollHistoryRef.current) ? programmaticScrollHistoryRef.current : [])
      .filter((entry) => (now - Number(entry?.at || 0)) <= INITIAL_THREAD_SCROLL_TRACE_WINDOW_MS);
    recentHistory.push({ at: now, source: nextSource });
    programmaticScrollHistoryRef.current = recentHistory;
    if (guard) {
      guard.scrollOpsWithin200ms = recentHistory.length;
    }

    const stack = isChatScrollTraceEnabled()
      ? String(new Error().stack || '')
        .split('\n')
        .slice(2, 8)
        .join('\n')
      : '';

    logChatDebug('threadScroll:programmatic', {
      source: nextSource,
      countWithin200ms: recentHistory.length,
      ...details,
      stack: stack || undefined,
    });

    if (stack) {
      console.debug('[chat-scroll-trace]', {
        source: nextSource,
        countWithin200ms: recentHistory.length,
        ...details,
        stack,
      });
    }
  }, [isChatScrollTraceEnabled, logChatDebug]);

  const resolvePendingInitialAnchorFromPayload = useCallback((conversationId, payload) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const pendingAnchor = pendingInitialAnchorRef.current;
    if (!normalizedConversationId || !pendingAnchor || pendingAnchor.conversationId !== normalizedConversationId) {
      if (normalizedConversationId && payload) {
        bufferedAnchorPayloadRef.current = { conversationId: normalizedConversationId, payload };
      }
      return false;
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const nextViewerLastReadMessageId = String(payload?.viewer_last_read_message_id || '').trim();
    const conversation = conversationsRef.current.find(
      (item) => String(item?.id || '').trim() === normalizedConversationId,
    ) || null;
    const derivedAnchor = resolveInitialAnchorState(items, nextViewerLastReadMessageId, conversation);
    const resolvedFields = resolvePendingAnchorFieldsFromPayload(payload, conversation, derivedAnchor);

    pendingAnchor.ready = true;
    pendingAnchor.startedAt = Date.now();
    pendingAnchor.mode = resolvedFields.mode;
    pendingAnchor.anchorMessageId = resolvedFields.anchorMessageId;
    pendingAnchor.anchorResolved = true;
    pendingAnchor.lastAppliedTarget = null;
    bufferedAnchorPayloadRef.current = null;
    logChatDebug('pendingAnchor:resolved', {
      conversationId: normalizedConversationId,
      mode: pendingAnchor.mode,
      anchorMessageId: pendingAnchor.anchorMessageId || null,
      source: resolvedFields.source,
    });
    return true;
  }, [conversationsRef, logChatDebug]);

  const clearPendingInitialAnchorSettleTimer = useCallback(() => {
    if (pendingInitialAnchorSettleTimeoutRef.current) {
      window.clearTimeout(pendingInitialAnchorSettleTimeoutRef.current);
      pendingInitialAnchorSettleTimeoutRef.current = null;
    }
  }, []);

  const clearPendingInitialAnchorRetryTimer = useCallback(() => {
    if (pendingInitialAnchorRetryTimeoutRef.current) {
      window.clearTimeout(pendingInitialAnchorRetryTimeoutRef.current);
      pendingInitialAnchorRetryTimeoutRef.current = null;
    }
  }, []);

  const clearPendingInitialAnchorResizeFrame = useCallback(() => {
    if (pendingInitialAnchorResizeFrameRef.current) {
      window.cancelAnimationFrame(pendingInitialAnchorResizeFrameRef.current);
      pendingInitialAnchorResizeFrameRef.current = null;
    }
  }, []);

  const cancelPendingInitialAnchor = useCallback(() => {
    pendingInitialAnchorRef.current = null;
    bufferedAnchorPayloadRef.current = null;
    clearPendingInitialAnchorSettleTimer();
    clearPendingInitialAnchorRetryTimer();
    clearPendingInitialAnchorResizeFrame();
    clearInitialViewportGuard('pending_anchor_cancel');
  }, [
    clearInitialViewportGuard,
    clearPendingInitialAnchorResizeFrame,
    clearPendingInitialAnchorRetryTimer,
    clearPendingInitialAnchorSettleTimer,
  ]);

  const applyPendingInitialAnchor = useCallback(({ source = 'pendingAnchor' } = {}) => {
    const pendingAnchor = pendingInitialAnchorRef.current;
    const container = threadScrollRef.current;
    if (!pendingAnchor || !container) return false;
    if (pendingAnchor.conversationId !== activeConversationIdRef.current) return false;
    if (!pendingAnchor.ready) return false;
    if (Number(container.clientHeight || 0) <= 0 && Number(container.scrollHeight || 0) <= 0) {
      return false;
    }
    if ((Date.now() - Number(pendingAnchor.startedAt || 0)) > INITIAL_THREAD_POSITION_MAX_MS) {
      logChatDebug('pendingAnchor:expired', {
        conversationId: pendingAnchor.conversationId,
        mode: pendingAnchor.mode,
      });
      cancelPendingInitialAnchor();
      return false;
    }

    if (pendingAnchor.mode === 'first_unread_top' && !pendingAnchor.anchorResolved) {
      if (messagesRef.current.length === 0) return false;
      pendingAnchor.anchorMessageId = getUnreadAnchorId(messagesRef.current, viewerLastReadMessageId);
      pendingAnchor.anchorResolved = true;
    }

    const nextScrollTop = computePendingInitialAnchorScrollTop({
      pendingAnchor,
      container,
      messages: messagesRef.current,
      viewerLastReadMessageId,
    });
    if (nextScrollTop === null) return false;

    const previousTarget = Number(pendingAnchor.lastAppliedTarget);
    const currentScrollTop = Number(container.scrollTop || 0);
    if (isPendingAnchorScrollUnchanged(previousTarget, currentScrollTop, nextScrollTop)) {
      const initialViewportGuard = initialViewportGuardRef.current;
      if (initialViewportGuard?.conversationId === pendingAnchor.conversationId) {
        initialViewportGuard.lastObservedScrollHeight = Math.round(Number(container.scrollHeight || 0));
      }
      syncThreadViewportState(container);
      logChatDebug('pendingAnchor:unchanged', {
        conversationId: pendingAnchor.conversationId,
        mode: pendingAnchor.mode,
        currentScrollTop: Math.round(currentScrollTop),
        nextScrollTop: Math.round(nextScrollTop),
      });
      return 'unchanged';
    }

    pendingAnchor.lastAppliedTarget = nextScrollTop;
    setThreadScrollTop(nextScrollTop, {
      source: `pendingAnchor:${source}`,
    });
    const initialViewportGuard = initialViewportGuardRef.current;
    if (initialViewportGuard?.conversationId === pendingAnchor.conversationId) {
      initialViewportGuard.correctionCount = Number(initialViewportGuard.correctionCount || 0) + 1;
      initialViewportGuard.lastObservedScrollHeight = Math.round(Number(container.scrollHeight || 0));
    }
    logChatDebug('pendingAnchor:applied', {
      conversationId: pendingAnchor.conversationId,
      mode: pendingAnchor.mode,
      nextScrollTop: Math.round(nextScrollTop),
      source,
    });
    return 'changed';
  }, [
    activeConversationIdRef,
    cancelPendingInitialAnchor,
    logChatDebug,
    messagesRef,
    setThreadScrollTop,
    syncThreadViewportState,
    threadScrollRef,
    viewerLastReadMessageId,
  ]);

  const schedulePendingInitialAnchorSettle = useCallback((reset = false) => {
    if (pendingInitialAnchorSettleTimeoutRef.current && !reset) return;
    clearPendingInitialAnchorSettleTimer();
    clearPendingInitialAnchorRetryTimer();
    const pendingAnchor = pendingInitialAnchorRef.current;
    if (!pendingAnchor) return;
    const conversationId = pendingAnchor.conversationId;
    pendingInitialAnchorSettleTimeoutRef.current = window.setTimeout(() => {
      const currentPendingAnchor = pendingInitialAnchorRef.current;
      if (!currentPendingAnchor) return;
      if (currentPendingAnchor.conversationId !== conversationId) return;
      if (currentPendingAnchor.conversationId !== activeConversationIdRef.current) return;
      logChatDebug('pendingAnchor:settled', {
        conversationId,
        mode: currentPendingAnchor.mode,
      });
      pendingInitialAnchorRef.current = null;
      pendingInitialAnchorSettleTimeoutRef.current = null;
    }, INITIAL_THREAD_POSITION_SETTLE_MS);
  }, [activeConversationIdRef, clearPendingInitialAnchorRetryTimer, clearPendingInitialAnchorSettleTimer, logChatDebug]);

  const schedulePendingInitialAnchorRetry = useCallback(() => {
    clearPendingInitialAnchorRetryTimer();
    const pendingAnchor = pendingInitialAnchorRef.current;
    if (!pendingAnchor) return;
    if (Number(pendingAnchor.retryCount || 0) >= 1) return;
    const conversationId = pendingAnchor.conversationId;
    pendingInitialAnchorRetryTimeoutRef.current = window.setTimeout(() => {
      pendingInitialAnchorRetryTimeoutRef.current = null;
      const currentPendingAnchor = pendingInitialAnchorRef.current;
      if (!currentPendingAnchor) return;
      if (currentPendingAnchor.conversationId !== conversationId) return;
      if (currentPendingAnchor.conversationId !== activeConversationIdRef.current) return;
      currentPendingAnchor.retryCount = Number(currentPendingAnchor.retryCount || 0) + 1;
      logChatDebug('pendingAnchor:retry', {
        conversationId,
        mode: currentPendingAnchor.mode,
        retryCount: currentPendingAnchor.retryCount,
      });
      const retryResult = applyPendingInitialAnchor({ source: 'settle_retry' });
      if (retryResult === 'changed') {
        schedulePendingInitialAnchorSettle(true);
        return;
      }
      if (retryResult === 'unchanged') {
        schedulePendingInitialAnchorSettle(false);
        return;
      }
      logChatDebug('pendingAnchor:retrySkipped', {
        conversationId,
        mode: currentPendingAnchor.mode,
        reason: 'dom_not_stable',
      });
    }, INITIAL_THREAD_POSITION_SETTLE_MS);
  }, [
    activeConversationIdRef,
    applyPendingInitialAnchor,
    clearPendingInitialAnchorRetryTimer,
    logChatDebug,
    schedulePendingInitialAnchorSettle,
  ]);

  const flushBufferedAnchorPayload = useCallback((conversationId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const buffered = bufferedAnchorPayloadRef.current;
    if (!normalizedConversationId || !buffered || buffered.conversationId !== normalizedConversationId) {
      return false;
    }
    bufferedAnchorPayloadRef.current = null;
    return resolvePendingInitialAnchorFromPayload(normalizedConversationId, buffered.payload);
  }, [resolvePendingInitialAnchorFromPayload]);

  const applyBufferedInitialAnchorAfterQueue = useCallback((conversationId) => {
    if (!flushBufferedAnchorPayload(conversationId)) return;
    queueMicrotask(() => {
      const anchorResult = applyPendingInitialAnchor({ source: 'queueInitialThreadPosition:buffer_flush' });
      if (anchorResult === 'changed') {
        schedulePendingInitialAnchorSettle(true);
        return;
      }
      if (anchorResult === 'unchanged') {
        schedulePendingInitialAnchorSettle(false);
        return;
      }
      if (pendingInitialAnchorRef.current?.ready) {
        schedulePendingInitialAnchorRetry();
      }
    });
  }, [
    applyPendingInitialAnchor,
    flushBufferedAnchorPayload,
    schedulePendingInitialAnchorRetry,
    schedulePendingInitialAnchorSettle,
  ]);

  const queueInitialThreadPosition = useCallback((conversationId, items = conversationsRef.current) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const nextMode = getInitialScrollMode(normalizedConversationId, items);
    logChatDebug('queueInitialThreadPosition', {
      conversationId: normalizedConversationId,
      nextMode: nextMode || false,
    });
    autoScrollRef.current = false;
    if (!normalizedConversationId || !nextMode) {
      cancelPendingInitialAnchor();
      return false;
    }
    const staleBufferedPayload = bufferedAnchorPayloadRef.current;
    if (staleBufferedPayload && staleBufferedPayload.conversationId !== normalizedConversationId) {
      bufferedAnchorPayloadRef.current = null;
    }
    beginInitialViewportGuard(normalizedConversationId, nextMode);
    autoScrollMetaRef.current = null;
    if (threadScrollRef.current) {
      setThreadScrollTop(0, { source: 'queueInitialThreadPosition:reset' });
      threadNearBottomRef.current = false;
      showJumpToLatestRef.current = false;
      setShowJumpToLatest(false);
    }
    clearPendingInitialAnchorSettleTimer();
    clearPendingInitialAnchorRetryTimer();
    pendingInitialAnchorRef.current = {
      conversationId: normalizedConversationId,
      mode: nextMode,
      startedAt: Date.now(),
      lastAppliedTarget: null,
      ready: false,
      anchorResolved: nextMode !== 'first_unread_top',
      anchorMessageId: '',
      retryCount: 0,
    };
    applyBufferedInitialAnchorAfterQueue(normalizedConversationId);
    return nextMode;
  }, [
    applyBufferedInitialAnchorAfterQueue,
    autoScrollMetaRef,
    autoScrollRef,
    beginInitialViewportGuard,
    cancelPendingInitialAnchor,
    clearPendingInitialAnchorRetryTimer,
    clearPendingInitialAnchorSettleTimer,
    conversationsRef,
    logChatDebug,
    setShowJumpToLatest,
    setThreadScrollTop,
    showJumpToLatestRef,
    threadNearBottomRef,
    threadScrollRef,
  ]);

  const hasPendingInitialAnchorForConversation = useCallback((conversationId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return false;
    return pendingInitialAnchorRef.current?.conversationId === normalizedConversationId;
  }, []);

  useEffect(() => () => {
    clearPendingInitialAnchorSettleTimer();
    clearPendingInitialAnchorRetryTimer();
    clearPendingInitialAnchorResizeFrame();
    clearInitialViewportGuard('unmount');
  }, [
    clearInitialViewportGuard,
    clearPendingInitialAnchorResizeFrame,
    clearPendingInitialAnchorRetryTimer,
    clearPendingInitialAnchorSettleTimer,
  ]);

  useEffect(() => {
    const contentNode = threadContentRef.current;
    if (!contentNode || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      if (prependScrollRestoreRef?.current) return;
      const pendingAnchor = pendingInitialAnchorRef.current;
      if (!pendingAnchor?.ready) return;
      if (pendingAnchor.conversationId !== activeConversationIdRef.current) return;
      if (!isInitialViewportGuardActive(pendingAnchor.conversationId)) return;
      if (threadNearBottomRef.current) return;

      const container = threadScrollRef.current;
      if (!container) return;
      const nextScrollHeight = Math.round(Number(container.scrollHeight || 0));
      const initialViewportGuard = initialViewportGuardRef.current;
      if (initialViewportGuard && initialViewportGuard.lastObservedScrollHeight === nextScrollHeight) return;

      clearPendingInitialAnchorResizeFrame();
      pendingInitialAnchorResizeFrameRef.current = window.requestAnimationFrame(() => {
        pendingInitialAnchorResizeFrameRef.current = null;
        queueMicrotask(() => {
          const currentPendingAnchor = pendingInitialAnchorRef.current;
          if (!currentPendingAnchor?.ready) return;
          if (currentPendingAnchor.conversationId !== activeConversationIdRef.current) return;
          if (!isInitialViewportGuardActive(currentPendingAnchor.conversationId)) return;
          const resizeResult = applyPendingInitialAnchor({ source: 'resize_observer' });
          if (resizeResult === 'changed') {
            logChatDebug('pendingAnchor:resizeChanged', {
              conversationId: currentPendingAnchor.conversationId,
              mode: currentPendingAnchor.mode,
              scrollHeight: nextScrollHeight,
            });
            schedulePendingInitialAnchorSettle(true);
            return;
          }
          if (resizeResult === 'unchanged') {
            schedulePendingInitialAnchorSettle(false);
            return;
          }
          schedulePendingInitialAnchorRetry();
        });
      });
    });

    observer.observe(contentNode);
    return () => {
      observer.disconnect();
      clearPendingInitialAnchorResizeFrame();
    };
  }, [
    activeConversationId,
    activeConversationIdRef,
    applyPendingInitialAnchor,
    clearPendingInitialAnchorResizeFrame,
    isInitialViewportGuardActive,
    logChatDebug,
    prependScrollRestoreRef,
    schedulePendingInitialAnchorRetry,
    schedulePendingInitialAnchorSettle,
    threadContentRef,
    threadNearBottomRef,
    threadScrollRef,
  ]);

  return {
    applyPendingInitialAnchor,
    beginInitialViewportGuard,
    cancelPendingInitialAnchor,
    clearInitialViewportGuard,
    clearPendingInitialAnchorResizeFrame,
    clearPendingInitialAnchorRetryTimer,
    clearPendingInitialAnchorSettleTimer,
    hasPendingInitialAnchorForConversation,
    isInitialViewportGuardActive,
    pendingInitialAnchorRef,
    queueInitialThreadPosition,
    resolvePendingInitialAnchorFromPayload,
    schedulePendingInitialAnchorRetry,
    schedulePendingInitialAnchorSettle,
    traceProgrammaticThreadScroll,
  };
}
