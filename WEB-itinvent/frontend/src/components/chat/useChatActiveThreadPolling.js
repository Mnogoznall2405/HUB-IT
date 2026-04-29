import { useEffect } from 'react';

import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';

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
}) {
  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !conversationBootstrapComplete) return undefined;

    const triggerForegroundRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if ((now - Number(lastForegroundRefreshAtRef.current || 0)) < 1250) return;
      if ((now - Number(lastConversationsLoadAtRef.current || 0)) < 3000) return;
      lastForegroundRefreshAtRef.current = now;

      if (!sidebarSearchActive) {
        void loadConversations({ silent: true, force: true });
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
  ]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || CHAT_WS_ENABLED) return undefined;
    const intervalId = window.setInterval(() => {
      if (!sidebarSearchActive) void loadConversations({ silent: true, force: true });
    }, listPollMs);
    return () => window.clearInterval(intervalId);
  }, [listPollMs, loadConversations, sidebarSearchActive]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || CHAT_WS_ENABLED || !activeConversationId) return undefined;
    const intervalId = window.setInterval(() => {
      void loadMessages(activeConversationId, { silent: true, reason: 'poll:thread', force: true });
    }, threadPollMs);
    return () => window.clearInterval(intervalId);
  }, [activeConversationId, loadMessages, threadPollMs]);

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
      const currentConversationId = String(activeConversationIdRef.current || normalizedConversationId).trim();
      if (!currentConversationId) return;
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
  ]);
}
