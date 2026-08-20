import { useCallback, useEffect } from 'react';

import {
  normalizeMailListViewContextState,
  updateMailListViewStateMap,
  writeStoredMailListViewState,
} from './mailViewStateModel';

export default function useMailListScrollState({
  listViewStateRef,
  pendingListScrollRestoreRef,
  messageListRef,
  currentListKeyRef,
  currentListContextKey,
} = {}) {
  const persistMailListViewState = useCallback((contextKey, updater) => {
    const normalizedContextKey = String(contextKey || '').trim();
    if (!normalizedContextKey) return;
    const nextState = updateMailListViewStateMap(listViewStateRef.current, normalizedContextKey, updater);
    listViewStateRef.current = nextState;
    writeStoredMailListViewState(nextState);
  }, [listViewStateRef]);

  const saveCurrentListScrollPosition = useCallback(({ contextKey, selectedMessageIdAtOpen } = {}) => {
    const resolvedContextKey = String(contextKey || currentListKeyRef.current || currentListContextKey || '').trim();
    if (!resolvedContextKey) return;
    const node = messageListRef.current;
    const nextScrollTop = Math.max(0, Number(node?.scrollTop || 0));
    persistMailListViewState(resolvedContextKey, (prev) => ({
      ...prev,
      scrollTop: nextScrollTop,
      selectedMessageIdAtOpen: selectedMessageIdAtOpen === undefined
        ? prev.selectedMessageIdAtOpen
        : String(selectedMessageIdAtOpen || ''),
    }));
  }, [currentListContextKey, currentListKeyRef, messageListRef, persistMailListViewState]);

  const queueListScrollRestore = useCallback((contextKey) => {
    const resolvedContextKey = String(contextKey || currentListKeyRef.current || currentListContextKey || '').trim();
    if (!resolvedContextKey) return;
    pendingListScrollRestoreRef.current = {
      contextKey: resolvedContextKey,
      ...normalizeMailListViewContextState(listViewStateRef.current?.[resolvedContextKey]),
    };
  }, [currentListContextKey, currentListKeyRef, listViewStateRef, pendingListScrollRestoreRef]);

  useEffect(() => {
    queueListScrollRestore(currentListContextKey);
  }, [currentListContextKey, queueListScrollRestore]);

  useEffect(() => () => {
    saveCurrentListScrollPosition({ contextKey: currentListContextKey });
  }, [currentListContextKey, saveCurrentListScrollPosition]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePageHide = () => {
      saveCurrentListScrollPosition();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [saveCurrentListScrollPosition]);

  return {
    persistMailListViewState,
    saveCurrentListScrollPosition,
    queueListScrollRestore,
  };
}
