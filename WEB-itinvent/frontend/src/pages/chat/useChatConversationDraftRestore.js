import { useEffect } from 'react';

const readLocalStorageItemDefault = (storageKey) => {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    return String(window.localStorage.getItem(storageKey) || '');
  } catch {
    return '';
  }
};

const writeLocalStorageItemDefault = (storageKey, value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey, String(value || ''));
  } catch {
    // Ignore browser storage failures for drafts.
  }
};

export function normalizeConversationId(conversationId) {
  return String(conversationId || '').trim();
}

export function isPendingShareDraftForConversation(pendingShareDraft, activeConversationId) {
  if (!pendingShareDraft) return false;
  return normalizeConversationId(pendingShareDraft.conversationId)
    === normalizeConversationId(activeConversationId);
}

export function resolveDraftRestoreMessageText({
  draftStorageKey,
  activeConversationId,
  pendingShareDraft,
  readLocalStorageItem,
} = {}) {
  if (!draftStorageKey) {
    return {
      messageText: '',
      clearPendingShareDraft: false,
      persistToStorage: false,
    };
  }
  if (isPendingShareDraftForConversation(pendingShareDraft, activeConversationId)) {
    const bodyText = String(pendingShareDraft.bodyText || '');
    return {
      messageText: bodyText,
      clearPendingShareDraft: true,
      persistToStorage: true,
      storageKey: draftStorageKey,
      storageValue: bodyText,
    };
  }
  try {
    return {
      messageText: readLocalStorageItem?.(draftStorageKey) || '',
      clearPendingShareDraft: false,
      persistToStorage: false,
    };
  } catch {
    return {
      messageText: '',
      clearPendingShareDraft: false,
      persistToStorage: false,
    };
  }
}

export function scheduleDraftSyncResume(callback, {
  setTimeoutFn = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout.bind(window)
    : undefined,
  clearTimeoutFn = typeof window !== 'undefined' && typeof window.clearTimeout === 'function'
    ? window.clearTimeout.bind(window)
    : undefined,
} = {}) {
  const timeoutId = setTimeoutFn?.(callback, 0);
  return () => {
    clearTimeoutFn?.(timeoutId);
  };
}

export default function useChatConversationDraftRestore({
  activeConversationId,
  draftStorageKey,
  latestMessageTextRef,
  setEditingMessage,
  setMessageText,
  setReplyMessage,
  shareComposeDraftRef,
  suppressDraftSyncRef,
  readLocalStorageItem = readLocalStorageItemDefault,
  writeLocalStorageItem = writeLocalStorageItemDefault,
} = {}) {
  useEffect(() => {
    suppressDraftSyncRef.current = true;
    setReplyMessage(null);
    setEditingMessage(null);

    const draftRestore = resolveDraftRestoreMessageText({
      draftStorageKey,
      activeConversationId,
      pendingShareDraft: shareComposeDraftRef.current,
      readLocalStorageItem,
    });

    if (draftRestore.clearPendingShareDraft) {
      shareComposeDraftRef.current = null;
      latestMessageTextRef.current = draftRestore.messageText;
    }

    setMessageText(draftRestore.messageText);

    if (draftRestore.persistToStorage) {
      writeLocalStorageItem(draftRestore.storageKey, draftRestore.storageValue);
    }

    return scheduleDraftSyncResume(() => {
      suppressDraftSyncRef.current = false;
    });
    // Only restore when the active conversation or its draft key changes.
    // Do not list read/write helpers, refs, or setState fns: unstable values
    // caused restore on every parent re-render and erased composer input while typing.
  }, [activeConversationId, draftStorageKey]);
}
