import { useCallback, useEffect } from 'react';

import { buildChatDraftKey, buildChatPinnedMessageKey } from '../../components/chat/chatHelpers';

export default function useChatDraftsAndPinned({
  userId,
  activeConversationId,
  messageText,
  pinnedMessage,
  setPinnedMessage,
  suppressDraftSyncRef,
  draftWriteTimeoutRef,
  latestDraftStorageKeyRef,
  latestMessageTextRef,
}) {
  const draftStorageKey = buildChatDraftKey(userId, activeConversationId);
  const pinnedStorageKey = buildChatPinnedMessageKey(userId, activeConversationId);

  const flushDraftToStorage = useCallback((storageKey, value) => {
    const normalizedStorageKey = String(storageKey || '').trim();
    if (!normalizedStorageKey) return;
    try {
      if (String(value || '').trim()) {
        window.localStorage.setItem(normalizedStorageKey, String(value || ''));
      } else {
        window.localStorage.removeItem(normalizedStorageKey);
      }
    } catch {
      // Ignore browser storage failures for drafts.
    }
  }, []);

  useEffect(() => {
    if (!draftStorageKey || suppressDraftSyncRef?.current) return undefined;
    if (draftWriteTimeoutRef?.current) {
      window.clearTimeout(draftWriteTimeoutRef.current);
    }
    const timeoutId = window.setTimeout(() => {
      if (draftWriteTimeoutRef) draftWriteTimeoutRef.current = null;
      flushDraftToStorage(draftStorageKey, messageText);
    }, 320);
    if (draftWriteTimeoutRef) draftWriteTimeoutRef.current = timeoutId;
    return () => {
      window.clearTimeout(timeoutId);
      if (draftWriteTimeoutRef?.current === timeoutId) {
        draftWriteTimeoutRef.current = null;
      }
    };
  }, [draftStorageKey, draftWriteTimeoutRef, flushDraftToStorage, messageText, suppressDraftSyncRef]);

  useEffect(() => {
    const flushPendingDraft = () => {
      if (draftWriteTimeoutRef?.current) {
        window.clearTimeout(draftWriteTimeoutRef.current);
        draftWriteTimeoutRef.current = null;
      }
      flushDraftToStorage(latestDraftStorageKeyRef?.current, latestMessageTextRef?.current);
    };

    window.addEventListener('pagehide', flushPendingDraft);
    return () => {
      window.removeEventListener('pagehide', flushPendingDraft);
      flushPendingDraft();
    };
  }, [draftWriteTimeoutRef, flushDraftToStorage, latestDraftStorageKeyRef, latestMessageTextRef]);

  useEffect(() => {
    const previousDraftKey = latestDraftStorageKeyRef?.current;
    if (previousDraftKey && previousDraftKey !== draftStorageKey) {
      if (draftWriteTimeoutRef?.current) {
        window.clearTimeout(draftWriteTimeoutRef.current);
        draftWriteTimeoutRef.current = null;
      }
      flushDraftToStorage(previousDraftKey, latestMessageTextRef?.current);
    }
    if (latestDraftStorageKeyRef) latestDraftStorageKeyRef.current = draftStorageKey;
  }, [draftStorageKey, draftWriteTimeoutRef, flushDraftToStorage, latestDraftStorageKeyRef, latestMessageTextRef]);

  const persistPinnedMessage = useCallback((nextPinned) => {
    if (!pinnedStorageKey) return;
    try {
      if (!nextPinned?.id) {
        window.localStorage.removeItem(pinnedStorageKey);
        return;
      }
      window.localStorage.setItem(pinnedStorageKey, JSON.stringify(nextPinned));
    } catch {
      // Ignore storage errors.
    }
  }, [pinnedStorageKey]);

  useEffect(() => {
    persistPinnedMessage(pinnedMessage);
  }, [persistPinnedMessage, pinnedMessage]);

  return {
    draftStorageKey,
    pinnedStorageKey,
    flushDraftToStorage,
    persistPinnedMessage,
  };
}
