import { useEffect, useRef } from 'react';

import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { emitAgentDebugLog } from '../../lib/debugClientLog';
import {
  CHAT_SWR_STALE_TIME_MS,
  isChatReadConcurrencyFullError,
  resolveChatReadRetryAfterMs,
} from '../../lib/chat/chatReadPolicy';

export const CHAT_CONVERSATIONS_RECONCILE_COOLDOWN_MS = 10_000;
export const CHAT_THREAD_POLL_BACKOFF_MAX_MS = 30_000;

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
  // Poll-loop state lives in a ref: switching between unhealthy transport
  // states (disconnected ↔ reconnecting, degraded ↔ offline) must not reset
  // backoff or trigger an immediate poll.
  const pollStateRef = useRef({ inFlight: false, backoffAttempt: 0, backoffUntil: 0 });
  const transportStateRef = useRef(activeThreadTransportState);
  transportStateRef.current = activeThreadTransportState;

  const normalizedConversationId = String(activeConversationId || '').trim();
  const shouldPoll = shouldPollActiveThreadIncrementally({
    activeConversationId: normalizedConversationId,
    transportState: activeThreadTransportState,
  });

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
    const pollState = pollStateRef.current;
    let cancelled = false;
    let timeoutId = 0;
    const scheduleNext = (delayMs) => {
      if (cancelled) return;
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(pollOnce, Math.max(250, Number(delayMs) || incrementalPollMs));
    };
    const isOfflineNow = () => typeof navigator !== 'undefined' && navigator.onLine === false;
    const pollOnce = () => {
      if (cancelled) return;
      if (pollState.inFlight || messagesLoadingRef.current) {
        scheduleNext(incrementalPollMs);
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        scheduleNext(incrementalPollMs);
        return;
      }
      if (isOfflineNow()) {
        scheduleNext(incrementalPollMs);
        return;
      }
      const now = Date.now();
      if (now < pollState.backoffUntil) {
        scheduleNext(pollState.backoffUntil - now);
        return;
      }
      const currentConversationId = String(activeConversationIdRef.current || normalizedConversationId).trim();
      if (!currentConversationId) {
        scheduleNext(incrementalPollMs);
        return;
      }
      pollState.inFlight = true;
      degradedThreadRevalidateCountRef.current += 1;
      logChatDebugRef.current?.('threadPoll:degradedRevalidate', {
        conversationId: currentConversationId,
        transportState: transportStateRef.current,
        count: Number(degradedThreadRevalidateCountRef.current || 0),
      });
      const request = loadMessagesRef.current?.(
        currentConversationId,
        buildActiveThreadPollLoadOptions(messagesRef.current),
      );
      Promise.resolve(request)
        .then(() => {
          pollState.backoffAttempt = 0;
          pollState.backoffUntil = 0;
        })
        .catch((error) => {
          pollState.backoffAttempt += 1;
          let waitMs = Math.min(
            CHAT_THREAD_POLL_BACKOFF_MAX_MS,
            incrementalPollMs * (2 ** (pollState.backoffAttempt - 1)),
          );
          if (isChatReadConcurrencyFullError(error)) {
            waitMs = Math.max(
              waitMs,
              resolveChatReadRetryAfterMs(error, { attempt: pollState.backoffAttempt }),
            );
          }
          waitMs = Math.max(250, Math.round(waitMs * (0.8 + Math.random() * 0.4)));
          pollState.backoffUntil = Date.now() + waitMs;
          logChatDebugRef.current?.('threadPoll:backoff', {
            conversationId: currentConversationId,
            waitMs,
            attempt: pollState.backoffAttempt,
            readConcurrencyFull: isChatReadConcurrencyFullError(error),
          });
        })
        .finally(() => {
          pollState.inFlight = false;
          const delay = pollState.backoffUntil > Date.now()
            ? (pollState.backoffUntil - Date.now())
            : incrementalPollMs;
          scheduleNext(delay);
        });
    };
    const handleOnline = () => {
      if (cancelled || pollState.inFlight) return;
      // Foreground reconcile already reloads the thread on 'online' — don't double-fetch.
      if (Date.now() - Number(lastForegroundRefreshAtRef.current || 0) < 250) return;
      pollState.backoffUntil = 0;
      window.clearTimeout(timeoutId);
      pollOnce();
    };
    window.addEventListener('online', handleOnline);
    pollOnce();
    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      window.clearTimeout(timeoutId);
    };
  }, [
    activeConversationId,
    activeConversationIdRef,
    buildActiveThreadPollLoadOptions,
    degradedThreadRevalidateCountRef,
    incrementalPollMs,
    lastForegroundRefreshAtRef,
    loadMessagesRef,
    logChatDebugRef,
    messagesLoadingRef,
    messagesRef,
    shouldPoll,
    shouldPollActiveThreadIncrementally,
  ]);
}
