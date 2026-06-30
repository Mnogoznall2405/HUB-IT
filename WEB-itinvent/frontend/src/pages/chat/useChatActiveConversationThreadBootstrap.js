import { useLayoutEffect } from 'react';

import { invalidateSWRCacheByPrefix, peekSWRCache } from '../../lib/swrCache';
import { buildChatThreadCacheKeyParts } from './chatCacheKeys';
import { CHAT_MOBILE_SCREEN_TRANSITION_MS } from './chatMobileModel';

const CHAT_SWR_STALE_TIME_MS = 30_000;

export function buildActiveConversationThreadLayoutKey(userCacheId, activeConversationId) {
  return `${userCacheId}:${String(activeConversationId || '').trim()}`;
}

export function shouldInvalidateThreadCacheFromNotification(requestedConversationId, activeConversationId) {
  return String(requestedConversationId || '').trim() === String(activeConversationId || '').trim();
}

export default function useChatActiveConversationThreadBootstrap({
  activeConversationId,
  applyLatestThreadPayload,
  cancelPendingInitialAnchorRef,
  clearInitialViewportGuard,
  clearMobileKeyboardSettleTimeouts,
  focusComposerRef,
  hydratedThreadConversationIdRef,
  isMobile,
  lastHandledThreadLayoutKeyRef,
  loadThreadBootstrap,
  logChatDebugRef,
  messagesLoadingRequestSeqRef,
  mobileMotionDisabled,
  olderHistoryExhaustedRef,
  queueInitialThreadPositionRef,
  requestedConversationId,
  resetMessageSearch,
  resolvePendingInitialAnchorFromPayload,
  setEditingMessage,
  setMessages,
  setMessagesHasMore,
  setMessagesHasNewer,
  setMessagesLoading,
  setOlderHistoryUnavailable,
  setReplyMessage,
  setViewerLastReadAt,
  setViewerLastReadMessageId,
  userCacheId,
}) {
  useLayoutEffect(() => {
    const layoutKey = buildActiveConversationThreadLayoutKey(userCacheId, activeConversationId);
    if (lastHandledThreadLayoutKeyRef.current === layoutKey) return;
    lastHandledThreadLayoutKeyRef.current = layoutKey;

    if (!activeConversationId) {
      logChatDebugRef.current?.('effect:activeConversation:clear');
      cancelPendingInitialAnchorRef.current?.();
      clearInitialViewportGuard('conversation_cleared');
      clearMobileKeyboardSettleTimeouts();
      hydratedThreadConversationIdRef.current = '';
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      messagesLoadingRequestSeqRef.current = 0;
      setMessagesLoading(false);
      setReplyMessage(null);
      setEditingMessage(null);
      return;
    }
    logChatDebugRef.current?.('effect:activeConversation:load', {
      conversationId: activeConversationId,
    });
    olderHistoryExhaustedRef.current.delete(activeConversationId);
    setOlderHistoryUnavailable(false);
    clearMobileKeyboardSettleTimeouts();

    const isFromNotification = shouldInvalidateThreadCacheFromNotification(
      requestedConversationId,
      activeConversationId,
    );

    if (isFromNotification) {
      invalidateSWRCacheByPrefix('chat', 'thread', userCacheId, activeConversationId);
    }

    const cachedThreadEntry = !isFromNotification
      ? peekSWRCache(
        buildChatThreadCacheKeyParts(userCacheId, activeConversationId),
        { staleTimeMs: CHAT_SWR_STALE_TIME_MS },
      )
      : null;

    const applyCachedThreadPayload = () => {
      if (!cachedThreadEntry?.data) return false;
      applyLatestThreadPayload(activeConversationId, cachedThreadEntry.data);
      resolvePendingInitialAnchorFromPayload(activeConversationId, cachedThreadEntry.data);
      setMessagesLoading(false);
      void loadThreadBootstrap(activeConversationId, {
        silent: true,
        reason: 'effect:activeConversation:revalidate',
        force: true,
      });
      setReplyMessage(null);
      setEditingMessage(null);
      resetMessageSearch();
      return true;
    };

    const startColdThreadLoad = () => {
      hydratedThreadConversationIdRef.current = '';
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      void loadThreadBootstrap(activeConversationId, {
        reason: isFromNotification ? 'effect:activeConversation:fromNotification' : 'effect:activeConversation',
        force: isFromNotification,
      });
      setReplyMessage(null);
      setEditingMessage(null);
      resetMessageSearch();
    };

    const scheduleInitialThreadPosition = () => {
      if (!isMobile || mobileMotionDisabled) {
        queueInitialThreadPositionRef.current?.(activeConversationId);
        return undefined;
      }
      const timeoutId = window.setTimeout(() => {
        queueInitialThreadPositionRef.current?.(activeConversationId);
      }, CHAT_MOBILE_SCREEN_TRANSITION_MS);
      return () => window.clearTimeout(timeoutId);
    };

    const scheduleFocusComposer = () => {
      if (!isMobile || mobileMotionDisabled) {
        focusComposerRef.current?.();
        return undefined;
      }
      const timeoutId = window.setTimeout(() => {
        focusComposerRef.current?.();
      }, CHAT_MOBILE_SCREEN_TRANSITION_MS);
      return () => window.clearTimeout(timeoutId);
    };

    if (cachedThreadEntry?.data) {
      const applied = applyCachedThreadPayload();
      if (applied) {
        const positionCleanup = scheduleInitialThreadPosition();
        const focusCleanup = scheduleFocusComposer();
        return () => {
          positionCleanup?.();
          focusCleanup?.();
        };
      }
    }

    startColdThreadLoad();
    const positionCleanup = scheduleInitialThreadPosition();
    const focusCleanup = scheduleFocusComposer();
    return () => {
      positionCleanup?.();
      focusCleanup?.();
    };
  }, [
    activeConversationId,
    applyLatestThreadPayload,
    cancelPendingInitialAnchorRef,
    clearInitialViewportGuard,
    clearMobileKeyboardSettleTimeouts,
    focusComposerRef,
    hydratedThreadConversationIdRef,
    isMobile,
    lastHandledThreadLayoutKeyRef,
    loadThreadBootstrap,
    logChatDebugRef,
    messagesLoadingRequestSeqRef,
    mobileMotionDisabled,
    olderHistoryExhaustedRef,
    queueInitialThreadPositionRef,
    requestedConversationId,
    resetMessageSearch,
    resolvePendingInitialAnchorFromPayload,
    setEditingMessage,
    setMessages,
    setMessagesHasMore,
    setMessagesHasNewer,
    setMessagesLoading,
    setOlderHistoryUnavailable,
    setReplyMessage,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    userCacheId,
  ]);
}
