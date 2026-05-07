import { useEffect } from 'react';

import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { pushNavigationDebugEntry } from '../../lib/navigationDebug';

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
  threadPollMs,
  incrementalPollMs,
  isChatRouteActive = () => true,
}) {
  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !conversationBootstrapComplete) return undefined;

    const triggerForegroundRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!isChatRouteActive()) return;
      const now = Date.now();
      if ((now - Number(lastForegroundRefreshAtRef.current || 0)) < 1250) return;
      if ((now - Number(lastConversationsLoadAtRef.current || 0)) < 3000) return;
      lastForegroundRefreshAtRef.current = now;

      if (!sidebarSearchActive) {
        pushNavigationDebugEntry('chat-poll:foreground:conversations', {
          activeConversationId: String(activeConversationIdRef.current || ''),
        });
        void loadConversations({ silent: true, force: true });
      }
      if (activeConversationIdRef.current && !messagesLoadingRef.current) {
        pushNavigationDebugEntry('chat-poll:foreground:messages', {
          activeConversationId: String(activeConversationIdRef.current || ''),
        });
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
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', triggerForegroundRefresh);
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
    isChatRouteActive,
  ]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || CHAT_WS_ENABLED) return undefined;
    const intervalId = window.setInterval(() => {
      if (!isChatRouteActive()) return;
      if (!sidebarSearchActive) void loadConversations({ silent: true, force: true });
    }, listPollMs);
    return () => window.clearInterval(intervalId);
  }, [isChatRouteActive, listPollMs, loadConversations, sidebarSearchActive]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || CHAT_WS_ENABLED || !activeConversationId) return undefined;
    const intervalId = window.setInterval(() => {
      if (!isChatRouteActive()) return;
      pushNavigationDebugEntry('chat-poll:thread', {
        activeConversationId: String(activeConversationId || ''),
      });
      void loadMessages(activeConversationId, { silent: true, reason: 'poll:thread', force: true });
    }, threadPollMs);
    return () => window.clearInterval(intervalId);
  }, [activeConversationId, isChatRouteActive, loadMessages, threadPollMs]);

  useEffect(() => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (!shouldPollActiveThreadIncrementally({
      activeConversationId: normalizedConversationId,
      transportState: activeThreadTransportState,
    })) {
      return undefined;
    }
    let cancelled = false;
    let inFlight = false;
    const pollOnce = () => {
      if (cancelled || inFlight || messagesLoadingRef.current) return;
      if (!isChatRouteActive()) return;
      const currentConversationId = String(activeConversationIdRef.current || normalizedConversationId).trim();
      if (!currentConversationId) return;
      inFlight = true;
      degradedThreadRevalidateCountRef.current += 1;
      pushNavigationDebugEntry('chat-poll:incremental', {
        activeConversationId: currentConversationId,
        transportState: activeThreadTransportState,
        count: Number(degradedThreadRevalidateCountRef.current || 0),
      });
      logChatDebugRef.current?.('threadPoll:degradedRevalidate', {
        conversationId: currentConversationId,
        transportState: activeThreadTransportState,
        count: Number(degradedThreadRevalidateCountRef.current || 0),
      });
      const request = loadMessagesRef.current?.(
        currentConversationId,
        buildActiveThreadPollLoadOptions(messagesRef.current),
      );
      Promise.resolve(request).finally(() => {
        inFlight = false;
      });
    };
    pollOnce();
    const intervalId = window.setInterval(pollOnce, incrementalPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
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
    isChatRouteActive,
  ]);
}
