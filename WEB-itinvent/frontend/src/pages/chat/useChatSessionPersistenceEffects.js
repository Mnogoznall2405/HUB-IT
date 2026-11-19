import { useEffect } from 'react';

import { setSWRCache } from '../../lib/swrCache';
import { buildChatThreadCacheKeyParts } from './chatCacheKeys';

export function shouldSyncConversationsCache(conversationsCacheHydratedRef) {
  return Boolean(conversationsCacheHydratedRef?.current);
}

export function shouldSyncAiBotsCache({ canUseAiChat, aiBotsCacheHydratedRef }) {
  return Boolean(canUseAiChat && aiBotsCacheHydratedRef?.current);
}

export function shouldSyncActiveThreadCache(activeConversationId, hydratedThreadConversationIdRef) {
  const normalizedConversationId = String(activeConversationId || '').trim();
  if (!normalizedConversationId) return false;
  return hydratedThreadConversationIdRef?.current === normalizedConversationId;
}

// The thread cache holds only the tail of the loaded history: without a cap,
// up to 80 cached conversations could each retain thousands of messages in
// the SWR map for 30 minutes. Older pages are re-fetched via has_more anyway.
export const CHAT_THREAD_CACHE_MESSAGE_LIMIT = 300;

export function buildActiveThreadCachePayload({
  messages,
  messagesHasMore,
  messagesHasNewer,
  viewerLastReadMessageId,
  viewerLastReadAt,
} = {}) {
  const list = Array.isArray(messages) ? messages : [];
  // R12: optimistic bubbles (sending/failed) never enter the thread cache —
  // the failed registry restores them, and a cached copy would otherwise be
  // mistaken for a persisted message on the next thread reload.
  const persistedList = list.filter((message) => !message?.isOptimistic && !message?.optimisticStatus);
  // U3: the live-appear flag must not survive a cache round-trip — restored
  // messages are history and must mount without the appear animation.
  const normalizedList = persistedList.some((message) => message?.animateAppear)
    ? persistedList.map((message) => {
      if (!message?.animateAppear) return message;
      const { animateAppear: _animateAppear, ...rest } = message;
      return rest;
    })
    : persistedList;
  const truncated = normalizedList.length > CHAT_THREAD_CACHE_MESSAGE_LIMIT;
  const items = truncated ? normalizedList.slice(-CHAT_THREAD_CACHE_MESSAGE_LIMIT) : normalizedList;
  return {
    items,
    has_more: truncated || messagesHasMore,
    has_older: truncated || messagesHasMore,
    has_newer: messagesHasNewer,
    viewer_last_read_message_id: viewerLastReadMessageId,
    viewer_last_read_at: viewerLastReadAt,
  };
}

export function resolveLastConversationSessionStorageAction(activeConversationId) {
  const normalizedConversationId = String(activeConversationId || '').trim();
  return normalizedConversationId
    ? { action: 'set', value: normalizedConversationId }
    : { action: 'remove' };
}

export function resolveLastMobileViewSessionStorageValue(mobileView) {
  return mobileView === 'thread' ? 'thread' : 'inbox';
}

export function syncLastConversationSessionStorage(
  activeConversationId,
  lastConversationSessionKey,
  sessionStorage = typeof window !== 'undefined' ? window.sessionStorage : undefined,
) {
  if (!sessionStorage || !lastConversationSessionKey) return;
  const storageAction = resolveLastConversationSessionStorageAction(activeConversationId);
  try {
    if (storageAction.action === 'set') {
      sessionStorage.setItem(lastConversationSessionKey, storageAction.value);
      return;
    }
    sessionStorage.removeItem(lastConversationSessionKey);
  } catch {
    // Ignore browser storage failures for chat session restore.
  }
}

export function syncLastMobileViewSessionStorage(
  mobileView,
  lastMobileViewSessionKey,
  sessionStorage = typeof window !== 'undefined' ? window.sessionStorage : undefined,
) {
  if (!sessionStorage || !lastMobileViewSessionKey) return;
  try {
    sessionStorage.setItem(
      lastMobileViewSessionKey,
      resolveLastMobileViewSessionStorageValue(mobileView),
    );
  } catch {
    // Ignore browser storage failures for chat session restore.
  }
}

export default function useChatSessionPersistenceEffects({
  activeConversationId,
  aiBots,
  aiBotsCacheHydratedRef,
  aiBotsCacheKeyParts,
  canUseAiChat,
  conversations,
  conversationsCacheHydratedRef,
  conversationsCacheKeyParts,
  hydratedThreadConversationIdRef,
  lastConversationSessionKey,
  lastMobileViewSessionKey,
  messages,
  messagesHasMore,
  messagesHasNewer,
  mobileView,
  syncSessionState = true,
  userCacheId,
  viewerLastReadAt,
  viewerLastReadMessageId,
}) {
  useEffect(() => {
    if (!shouldSyncConversationsCache(conversationsCacheHydratedRef)) return;
    setSWRCache(conversationsCacheKeyParts, { items: conversations });
  }, [conversations, conversationsCacheHydratedRef, conversationsCacheKeyParts]);

  useEffect(() => {
    if (!shouldSyncAiBotsCache({ canUseAiChat, aiBotsCacheHydratedRef })) return;
    setSWRCache(aiBotsCacheKeyParts, { items: aiBots });
  }, [aiBots, aiBotsCacheHydratedRef, aiBotsCacheKeyParts, canUseAiChat]);

  useEffect(() => {
    if (!shouldSyncActiveThreadCache(activeConversationId, hydratedThreadConversationIdRef)) return;
    const normalizedConversationId = String(activeConversationId || '').trim();
    setSWRCache(
      buildChatThreadCacheKeyParts(userCacheId, normalizedConversationId),
      buildActiveThreadCachePayload({
        messages,
        messagesHasMore,
        messagesHasNewer,
        viewerLastReadAt,
        viewerLastReadMessageId,
      }),
    );
  }, [
    activeConversationId,
    hydratedThreadConversationIdRef,
    messages,
    messagesHasMore,
    messagesHasNewer,
    userCacheId,
    viewerLastReadAt,
    viewerLastReadMessageId,
  ]);

  useEffect(() => {
    if (!syncSessionState) return;
    syncLastConversationSessionStorage(activeConversationId, lastConversationSessionKey);
  }, [activeConversationId, lastConversationSessionKey, syncSessionState]);

  useEffect(() => {
    if (!syncSessionState) return;
    syncLastMobileViewSessionStorage(mobileView, lastMobileViewSessionKey);
  }, [lastMobileViewSessionKey, mobileView, syncSessionState]);
}
