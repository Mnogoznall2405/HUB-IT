import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';

const DEFAULT_SEARCH_DEBOUNCE_MS = 250;

export const EMPTY_SEARCH_FILTERS = Object.freeze({ senderUserId: '', createdFrom: '', createdTo: '', kind: '' });

export function hasSearchFilters(filters) {
  return Boolean(filters && (filters.senderUserId || filters.createdFrom || filters.createdTo || filters.kind));
}

// A picked calendar day covers the whole local day: from its first to its last millisecond.
function dayBoundary(value, endOfDay) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const parsed = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function buildSearchParams({ query, filters, limit, beforeMessageId }) {
  return {
    q: query,
    limit,
    before_message_id: beforeMessageId || undefined,
    sender_user_id: filters?.senderUserId ? Number(filters.senderUserId) : undefined,
    created_from: dayBoundary(filters?.createdFrom, false),
    created_to: dayBoundary(filters?.createdTo, true),
    kind: filters?.kind || undefined,
  };
}

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
  const [messageSearch, setMessageSearchState] = useState('');
  const [messageSearchFilters, setMessageSearchFiltersState] = useState(EMPTY_SEARCH_FILTERS);
  const [messageSearchResults, setMessageSearchResults] = useState([]);
  const [messageSearchLoading, setMessageSearchLoading] = useState(false);
  const [messageSearchHasMore, setMessageSearchHasMore] = useState(false);
  notifyApiErrorRef.current = notifyApiError;

  const invalidateSearch = useCallback(() => {
    requestSeqRef.current += 1;
    setMessageSearchLoading(false);
  }, []);

  const setMessageSearch = useCallback((value) => {
    invalidateSearch();
    setMessageSearchState(value);
    setMessageSearchResults([]);
    setMessageSearchHasMore(false);
    messageSearchBeforeIdRef.current = '';
  }, [invalidateSearch]);

  const setMessageSearchFilters = useCallback((patch) => {
    invalidateSearch();
    setMessageSearchFiltersState((current) => ({ ...current, ...patch }));
    setMessageSearchResults([]);
    setMessageSearchHasMore(false);
    messageSearchBeforeIdRef.current = '';
  }, [invalidateSearch]);

  useLayoutEffect(() => {
    invalidateSearch();
    setMessageSearchResults([]);
    setMessageSearchHasMore(false);
    messageSearchBeforeIdRef.current = '';
    return () => { requestSeqRef.current += 1; };
  }, [activeConversationId, invalidateSearch]);

  const resetMessageSearch = useCallback(() => {
    invalidateSearch();
    setSearchOpen(false);
    setMessageSearch('');
    setMessageSearchFiltersState(EMPTY_SEARCH_FILTERS);
    setMessageSearchResults([]);
    setMessageSearchHasMore(false);
    messageSearchBeforeIdRef.current = '';
  }, [invalidateSearch, setMessageSearch]);

  const runMessageSearch = useCallback(async ({ reset = false } = {}) => {
    const conversationId = String(activeConversationIdRef.current || activeConversationId || '').trim();
    const query = String(messageSearch || '').trim();
    if (!conversationId || (!query && !hasSearchFilters(messageSearchFilters))) {
      setMessageSearchResults([]);
      setMessageSearchHasMore(false);
      messageSearchBeforeIdRef.current = '';
      return;
    }

    const reqSeq = ++requestSeqRef.current;
    setMessageSearchLoading(true);
    try {
      const beforeMessageId = reset ? '' : String(messageSearchBeforeIdRef.current || '').trim();
      const data = await chatAPI.searchMessages(conversationId, buildSearchParams({
        query,
        filters: messageSearchFilters,
        limit: 20,
        beforeMessageId,
      }));
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
  }, [activeConversationId, activeConversationIdRef, messageSearch, messageSearchFilters]);

  useEffect(() => {
    if (!searchOpen || !activeConversationId) return undefined;
    const timeoutId = window.setTimeout(() => {
      void runMessageSearch({ reset: true });
    }, searchDebounceMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeConversationId, messageSearch, messageSearchFilters, runMessageSearch, searchDebounceMs, searchOpen]);

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
    invalidateSearch();
    setSearchOpen(false);
  }, [invalidateSearch]);

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
    messageSearchFilters,
    messageSearchHasMore,
    messageSearchLoading,
    messageSearchResults,
    openSearchDialog,
    openSearchResult,
    resetMessageSearch,
    searchOpen,
    setMessageSearch,
    setMessageSearchFilters,
  };
}
