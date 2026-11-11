import { useCallback, useEffect, useRef, useState } from 'react';

const normalizeSelectionMode = (value) => (value === 'conversations' ? 'conversations' : 'messages');

export default function useMailSelectedDetailState({
  initialSelectedByMode = { messages: '', conversations: '' },
  viewMode = 'messages',
  setSelectedItems = () => {},
  setMoveTarget = () => {},
  queueListScrollRestore = () => {},
} = {}) {
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [selectedByMode, setSelectedByMode] = useState(initialSelectedByMode);

  const detailRequestAbortRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const selectedMessageRef = useRef(selectedMessage);
  const selectedConversationRef = useRef(selectedConversation);
  const detailContextRef = useRef('');
  const suppressNextAutoReadRef = useRef('');

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { selectedMessageRef.current = selectedMessage; }, [selectedMessage]);
  useEffect(() => { selectedConversationRef.current = selectedConversation; }, [selectedConversation]);

  const abortDetailRequest = useCallback(() => {
    if (detailRequestAbortRef.current) {
      detailRequestAbortRef.current.abort();
      detailRequestAbortRef.current = null;
    }
  }, []);

  const clearSelection = useCallback(({ mode = viewMode, allModes = false, restoreListState = false } = {}) => {
    abortDetailRequest();
    const targetMode = normalizeSelectionMode(mode);
    if (restoreListState && targetMode === 'messages') {
      queueListScrollRestore();
    }
    detailContextRef.current = '';
    selectedIdRef.current = '';
    setDetailLoading(false);
    setMoveTarget('');
    setSelectedId('');
    setSelectedByMode((prev) => {
      const current = prev || {};
      if (allModes) {
        if (!current.messages && !current.conversations) return current;
        return { ...current, messages: '', conversations: '' };
      }
      if (!current[targetMode]) return current;
      return { ...current, [targetMode]: '' };
    });
    setSelectedMessage(null);
    setSelectedConversation(null);
  }, [abortDetailRequest, queueListScrollRestore, setMoveTarget, viewMode]);

  const restoreMobileHistorySelection = useCallback((nextState) => {
    if (!nextState?.selectedId) return;
    const selectionMode = normalizeSelectionMode(nextState.selectionMode);
    setSelectedItems([]);
    setSelectedByMode((prev) => ({ ...(prev || {}), [selectionMode]: nextState.selectedId }));
    selectedIdRef.current = nextState.selectedId;
    setSelectedId(nextState.selectedId);
  }, [setSelectedItems]);

  return {
    detailLoading,
    setDetailLoading,
    selectedId,
    setSelectedId,
    selectedMessage,
    setSelectedMessage,
    selectedConversation,
    setSelectedConversation,
    selectedByMode,
    setSelectedByMode,
    detailRequestAbortRef,
    selectedIdRef,
    selectedMessageRef,
    selectedConversationRef,
    detailContextRef,
    suppressNextAutoReadRef,
    abortDetailRequest,
    clearSelection,
    restoreMobileHistorySelection,
  };
}
