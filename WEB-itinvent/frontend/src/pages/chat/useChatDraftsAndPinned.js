import { useCallback, useEffect } from 'react';



import { buildChatDraftKey, buildChatPinnedMessageKey } from '../../components/chat/chatHelpers';
import {
  chatDraftWritesSealed,
  recordChatDraftClear,
  recordChatDraftWrite,
  sweepChatDrafts,
} from '../../lib/chatDraftsStorage';



export default function useChatDraftsAndPinned({

  userId,

  activeConversationId,

  messageText,

  pinnedMessage,

  setPinnedMessage,

  suppressDraftSyncRef,

  draftWriteTimeoutRef,

  editDraftSnapshotRef,
  latestDraftStorageKeyRef,

  latestMessageTextRef,

}) {

  const draftStorageKey = buildChatDraftKey(userId, activeConversationId);

  const pinnedStorageKey = buildChatPinnedMessageKey(userId, activeConversationId);

  // FE-063: на входе в чат выметаем протухшие черновики и хвост сверх лимита —
  // без этого chat:draft:* ключи копились бы бессрочно.
  useEffect(() => {
    if (!userId) return;
    sweepChatDrafts();
  }, [userId]);



  const flushDraftToStorage = useCallback((storageKey, value) => {

    const normalizedStorageKey = String(storageKey || '').trim();

    // Writes are sealed after the logout sweep: the unmount flush must not
    // resurrect a draft that clearAllChatDrafts() just removed.
    if (!normalizedStorageKey || chatDraftWritesSealed()) return;

    try {

      if (String(value || '').trim()) {

        window.localStorage.setItem(normalizedStorageKey, String(value || ''));

        recordChatDraftWrite(normalizedStorageKey);

      } else {

        window.localStorage.removeItem(normalizedStorageKey);

        recordChatDraftClear(normalizedStorageKey);

      }

    } catch {

      // Ignore browser storage failures for drafts.

    }

  }, []);



  // FE-004: while a message edit occupies the composer, its text belongs
  // to the edited message - every draft write must persist the snapshot
  // taken on entry instead of the edit body.
  const draftValue = useCallback((storageKey, value) => (
    editDraftSnapshotRef?.current?.key === storageKey
      ? editDraftSnapshotRef.current.text
      : value
  ), [editDraftSnapshotRef]);

  useEffect(() => {

    if (!draftStorageKey || suppressDraftSyncRef?.current) return undefined;

    if (draftWriteTimeoutRef?.current) {

      window.clearTimeout(draftWriteTimeoutRef.current);

    }

    const timeoutId = window.setTimeout(() => {

      if (draftWriteTimeoutRef) draftWriteTimeoutRef.current = null;

      flushDraftToStorage(draftStorageKey, draftValue(draftStorageKey, messageText));
    }, 320);

    if (draftWriteTimeoutRef) draftWriteTimeoutRef.current = timeoutId;

    return () => {

      window.clearTimeout(timeoutId);

      if (draftWriteTimeoutRef?.current === timeoutId) {

        draftWriteTimeoutRef.current = null;

      }

    };

  }, [draftStorageKey, draftValue, draftWriteTimeoutRef, flushDraftToStorage, messageText, suppressDraftSyncRef]);


  useEffect(() => {

    const flushPendingDraft = () => {

      if (draftWriteTimeoutRef?.current) {

        window.clearTimeout(draftWriteTimeoutRef.current);

        draftWriteTimeoutRef.current = null;

      }

      flushDraftToStorage(latestDraftStorageKeyRef?.current,
        draftValue(latestDraftStorageKeyRef?.current, latestMessageTextRef?.current),
      );
    };



    window.addEventListener('pagehide', flushPendingDraft);

    return () => {

      window.removeEventListener('pagehide', flushPendingDraft);

      flushPendingDraft();

    };

  }, [draftValue, draftWriteTimeoutRef, flushDraftToStorage, latestDraftStorageKeyRef, latestMessageTextRef]);


  useEffect(() => {

    const previousDraftKey = latestDraftStorageKeyRef?.current;

    if (previousDraftKey && previousDraftKey !== draftStorageKey) {

      if (draftWriteTimeoutRef?.current) {

        window.clearTimeout(draftWriteTimeoutRef.current);

        draftWriteTimeoutRef.current = null;

      }

      flushDraftToStorage(previousDraftKey, draftValue(previousDraftKey, latestMessageTextRef?.current));
    }

    if (latestDraftStorageKeyRef) latestDraftStorageKeyRef.current = draftStorageKey;

  }, [draftStorageKey, draftValue, draftWriteTimeoutRef, flushDraftToStorage, latestDraftStorageKeyRef, latestMessageTextRef]);


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
