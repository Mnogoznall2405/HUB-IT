import { useEffect, useRef } from 'react';

import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { emitAgentDebugLog } from '../../lib/debugClientLog';
import {
  CHAT_SWR_STALE_TIME_MS,
  isChatReadConcurrencyFullError,
  resolveChatReadRetryAfterMs,
} from '../../lib/chat/chatReadPolicy';

export const CHAT_CONVERSATIONS_RECONCILE_COOLDOWN_MS = 10_000;

export default function useChatActiveThreadPolling({
  activeConversationId,
  activeConversationIdRef,
  activeThreadTransportState,
  buildActiveThreadPollLoadOptions,
  conversationBootstrapComplete,
  degradedThreadRevalidateCountRef,
  lastConversationsLoadAtRef,
  lastForegroundRefreshAtRef,
  listPollMs,
  loadConversations,
  loadMessages,
  loadMessagesRef,
  logChatDebugRef,
  messagesLoadingRef,
  messagesRef,
  sidebarSearchActive,
  shouldPollActiveThreadIncrementally,
  socketStatus,
  threadPollMs,
  incrementalPollMs,
}) {
  const sawWsDisconnectRef = useRef(false);

  useEffect(() => {
    const state = String(socketStatus || '').toLowerCase();
    if (CHAT_WS_ENABLED && state && state !== 'connected') {
      sawWsDisconnectRef.current = true;
    }
  }, [socketStatus]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !conversationBootstrapComplete) return undefined;

    const shouldReconcileOnVisible = () => {
      const now = Date.now();
      const listAge = now - Number(lastConversationsLoadAtRef.current || 0);
      const listStale = listAge >= Number(CHAT_SWR_STALE_TIME_MS || 30_000);
      const transport = String(socketStatus || '').toLowerCase();
      const transportUnhealthy = CHAT_WS_ENABLED
        && transport !== 'connected';
      const wsGap = Boolean(sawWsDisconnectRef.current) || transportUnhealthy;
      return listStale || wsGap || !CHAT_WS_ENABLED;
    };

    const triggerForegroundRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (
        (now - Number(lastForegroundRefreshAtRef.current || 0))
        < CHAT_CONVERSATIONS_RECONCILE_COOLDOWN_MS
      ) return;
      // WS healthy + list fresh + no cursor/reconnect gap → do nothing on focus.
      if (!shouldReconcileOnVisible()) return;
      if ((now - Number(lastConversationsLoadAtRef.current || 0)) < 3000 && CHAT_WS_ENABLED) return;
      lastForegroundRefreshAtRef.current = now;
      sawWsDisconnectRef.current = false;

      // One reconcile only when stale / WS gap / no WS.
      if (!sidebarSearchActive) {
        void Promise.resolve(loadConversations({ silent: true, force: true })).catch(() => {});
      }
      if (activeConversationIdRef.current && !messagesLoadingRef.current) {
        void loadMessagesRef.current?.(activeConversationIdRef.current, {
          silent: true,
          reason: 'window:foreground',
          force: true,
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      triggerForegroundRefresh();
    };

    window.addEventListener('focus', triggerForegroundRefresh);
    window.addEventListener('online', triggerForegroundRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', triggerForegroundRefresh);
      window.removeEventListener('online', triggerForegroundRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    activeConversationIdRef,
    conversationBootstrapComplete,
    lastConversationsLoadAtRef,
    lastForegroundRefreshAtRef,
    loadConversations,
    loadMessagesRef,
    messagesLoadingRef,
    sidebarSearchActive,
    socketStatus,
  ]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || CHAT_WS_ENABLED) return undefined;
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!sidebarSearchActive) {
        void Promise.resolve(loadConversations({ silent: true, force: true })).catch(() => {});
      }
    }, listPollMs);
    return () => window.clearInterval(intervalId);
  }, [listPollMs, loadConversations, sidebarSearchActive]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || CHAT_WS_ENABLED || !activeConversationId) return undefined;
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void Promise.resolve(
        loadMessages(activeConversationId, { silent: true, reason: 'poll:thread', force: true }),
      ).catch(() => {});
    }, threadPollMs);
    return () => window.clearInterval(intervalId);
  }, [activeConversationId, loadMessages, threadPollMs]);

  useEffect(() => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    const shouldPoll = shouldPollActiveThreadIncrementally({
      activeConversationId: normalizedConversationId,
      transportState: activeThreadTransportState,
    });
    // #region agent log
    emitAgentDebugLog({
      location: 'useChatActiveThreadPolling.js:transport',
      message: shouldPoll ? 'incremental poll enabled' : 'incremental poll skipped (healthy or inactive)',
      hypothesisId: 'H4',
      data: {
        conversationId: normalizedConversationId,
        transportState: activeThreadTransportState,
        shouldPoll,
        chatWsEnabled: CHAT_WS_ENABLED,
      },
    });
    // #endregion
    if (!shouldPoll) {
      return undefined;
    }
    let cancelled = false;
    let inFlight = false;
    let backoffAttempt = 0;
    let backoffUntil = 0;
    let timeoutId = 0;
    const scheduleNext = (delayMs) => {
      if (cancelled) return;
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(pollOnce, Math.max(250, Number(delayMs) || incrementalPollMs));
    };
    const pollOnce = () => {
      if (cancelled) return;
      if (inFlight || messagesLoadingRef.current) {
        scheduleNext(incrementalPollMs);
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        scheduleNext(incrementalPollMs);
        return;
      }
      const now = Date.now();
      if (now < backoffUntil) {
        scheduleNext(backoffUntil - now);
        return;
      }
      const currentConversationId = String(activeConversationIdRef.current || normalizedConversationId).trim();
      if (!currentConversationId) {
        scheduleNext(incrementalPollMs);
        return;
      }
      inFlight = true;
      degradedThreadRevalidateCountRef.current += 1;
      logChatDebugRef.current?.('threadPoll:degradedRevalidate', {
        conversationId: currentConversationId,
        transportState: activeThreadTransportState,
        count: Number(degradedThreadRevalidateCountRef.current || 0),
      });
      const request = loadMessagesRef.current?.(
        currentConversationId,
        buildActiveThreadPollLoadOptions(messagesRef.current),
      );
      Promise.resolve(request)
        .then(() => {
          backoffAttempt = 0;
          backoffUntil = 0;
        })
        .catch((error) => {
          if (isChatReadConcurrencyFullError(error)) {
            const waitMs = resolveChatReadRetryAfterMs(error, { attempt: backoffAttempt });
            backoffAttempt += 1;
            backoffUntil = Date.now() + waitMs;
            logChatDebugRef.current?.('threadPoll:readConcurrencyBackoff', {
              conversationId: currentConversationId,
              waitMs,
              attempt: backoffAttempt,
            });
          }
        })
        .finally(() => {
          inFlight = false;
          const delay = backoffUntil > Date.now()
            ? (backoffUntil - Date.now())
            : incrementalPollMs;
          scheduleNext(delay);
        });
    };
    pollOnce();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    activeConversationId,
    activeConversationIdRef,
    activeThreadTransportState,
    buildActiveThreadPollLoadOptions,
    degradedThreadRevalidateCountRef,
    incrementalPollMs,
    loadMessagesRef,
    logChatDebugRef,
    messagesLoadingRef,
    messagesRef,
    shouldPollActiveThreadIncrementally,
  ]);
}
