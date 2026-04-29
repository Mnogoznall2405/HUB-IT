import { useCallback, useEffect, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';

const DEFAULT_SEARCH_DEBOUNCE_MS = 250;

export default function useChatMessageSearch({
  activeConversationId,
  activeConversationIdRef,
  loadChatDialogsModule,
  notifyApiError,
  notifyInfo,
  revealMessageRef,
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setThreadMenuAnchor,
}) {
  const requestSeqRef = useRef(0);
  const messageSearchBeforeIdRef = useRef('');
  const notifyApiErrorRef = useRef(notifyApiError);
  const [searchOpen, setSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [messageSearchResults, setMessageSearchResults] = useState([]);
  const [messageSearchLoading, setMessageSearchLoading] = useState(false);
  const [messageSearchHasMore, setMessageSearchHasMore] = useState(false);
  notifyApiErrorRef.current = notifyApiError;

  const resetMessageSearch = useCallback(() => {
    setSearchOpen(false);
    setMessageSearch('');
    setMessageSearchResults([]);
    setMessageSearchHasMore(false);
    messageSearchBeforeIdRef.current = '';
  }, []);

  const runMessageSearch = useCallback(async ({ reset = false } = {}) => {
    const conversationId = String(activeConversationIdRef.current || activeConversationId || '').trim();
    const query = String(messageSearch || '').trim();
    if (!conversationId || !query) {
      setMessageSearchResults([]);
      setMessageSearchHasMore(false);
      messageSearchBeforeIdRef.current = '';
      return;
    }

    const reqSeq = ++requestSeqRef.current;
    setMessageSearchLoading(true);
    try {
      const beforeMessageId = reset ? '' : String(messageSearchBeforeIdRef.current || '').trim();
      const data = await chatAPI.searchMessages(conversationId, {
        q: query,
        limit: 20,
        before_message_id: beforeMessageId || undefined,
      });
      if (reqSeq !== requestSeqRef.current) return;

      const items = Array.isArray(data?.items) ? data.items : [];
      const nextBeforeMessageId = items[items.length - 1]?.id || beforeMessageId || '';
      setMessageSearchResults((current) => (reset ? items : [...current, ...items]));
      setMessageSearchHasMore(Boolean(data?.has_more));
      messageSearchBeforeIdRef.current = nextBeforeMessageId;
    } catch (error) {
      if (reqSeq !== requestSeqRef.current) return;
      notifyApiErrorRef.current?.(error, 'Не удалось выполнить поиск по сообщениям.');
      if (reset) {
        setMessageSearchResults([]);
        setMessageSearchHasMore(false);
        messageSearchBeforeIdRef.current = '';
      }
    } finally {
      if (reqSeq === requestSeqRef.current) {
        setMessageSearchLoading(false);
      }
    }
  }, [activeConversationId, activeConversationIdRef, messageSearch]);

  useEffect(() => {
    if (!searchOpen || !activeConversationId) return undefined;
    const timeoutId = window.setTimeout(() => {
      void runMessageSearch({ reset: true });
    }, searchDebounceMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeConversationId, messageSearch, runMessageSearch, searchDebounceMs, searchOpen]);

  const openSearchDialog = useCallback(() => {
    void loadChatDialogsModule();
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
    setSearchOpen(true);
    setMessageSearchResults([]);
    setMessageSearchHasMore(false);
    messageSearchBeforeIdRef.current = '';
  }, [loadChatDialogsModule, setMessageMenuAnchor, setMessageMenuMessage, setThreadMenuAnchor]);

  const closeSearchDialog = useCallback(() => {
    setSearchOpen(false);
  }, []);

  const loadMoreSearchResults = useCallback(async () => {
    if (!messageSearchHasMore || messageSearchLoading) return;
    await runMessageSearch({ reset: false });
  }, [messageSearchHasMore, messageSearchLoading, runMessageSearch]);

  const openSearchResult = useCallback(async (message) => {
    const normalizedMessageId = String(message?.id || '').trim();
    if (!normalizedMessageId) return;
    const revealMessage = revealMessageRef?.current;
    const found = typeof revealMessage === 'function' ? await revealMessage(normalizedMessageId) : false;
    if (!found) {
      notifyInfo?.('Не удалось найти это сообщение в загруженной истории. Попробуйте повторить поиск.', { title: 'Сообщение не найдено' });
      return;
    }
    setSearchOpen(false);
  }, [notifyInfo, revealMessageRef]);

  return {
    closeSearchDialog,
    loadMoreSearchResults,
    messageSearch,
    messageSearchHasMore,
    messageSearchLoading,
    messageSearchResults,
    openSearchDialog,
    openSearchResult,
    resetMessageSearch,
    searchOpen,
    setMessageSearch,
  };
}
