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

export function buildActiveThreadCachePayload({
  messages,
  messagesHasMore,
  messagesHasNewer,
  viewerLastReadMessageId,
  viewerLastReadAt,
} = {}) {
  return {
    items: messages,
    has_more: messagesHasMore,
    has_older: messagesHasMore,
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
    syncLastConversationSessionStorage(activeConversationId, lastConversationSessionKey);
  }, [activeConversationId, lastConversationSessionKey]);

  useEffect(() => {
    syncLastMobileViewSessionStorage(mobileView, lastMobileViewSessionKey);
  }, [lastMobileViewSessionKey, mobileView]);
}
