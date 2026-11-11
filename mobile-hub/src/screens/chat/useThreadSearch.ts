import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as chatApi from '../../api/chatApi';
import type { ChatMessage } from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { showNativeToast } from '../../components/nativeToast';

/** In-thread message search: query state, offline local corpus, remote search. */
export function useThreadSearch({
  conversationId,
  userId,
  offlineMode,
  mountedRef,
  accumulatedMessagesRef,
  messages,
}: {
  conversationId: string;
  userId?: number;
  offlineMode: boolean;
  mountedRef: MutableRefObject<boolean>;
  accumulatedMessagesRef: MutableRefObject<ChatMessage[]>;
  messages: ChatMessage[];
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const searchRequestRef = useRef(0);

  useEffect(() => {
    searchRequestRef.current += 1;
    setSearching(false);
    return () => { searchRequestRef.current += 1; };
  }, [searchQuery, searchOpen, offlineMode, conversationId, userId]);

  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchCompleted(false);
  }, [conversationId, userId]);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query || searching) return;
    const request = ++searchRequestRef.current;
    const currentSearch = () => mountedRef.current && searchRequestRef.current === request;
    setSearching(true);
    setSearchCompleted(false);
    if (offlineMode) {
      const normalizedQuery = query.toLocaleLowerCase('ru-RU');
      const corpus = accumulatedMessagesRef.current.length
        ? accumulatedMessagesRef.current
        : messages;
      setSearchResults(corpus.filter((message) => (
        String(message.body_text || '').toLocaleLowerCase('ru-RU').includes(normalizedQuery)
      )));
      setSearchCompleted(true);
      setSearching(false);
      return;
    }
    try {
      const results = await chatApi.searchMessages(conversationId, query);
      if (currentSearch()) {
        setSearchResults(results);
        setSearchCompleted(true);
      }
    } catch (cause) {
      if (currentSearch()) {
        showNativeToast('Не удалось выполнить поиск', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (currentSearch()) setSearching(false);
    }
  }, [accumulatedMessagesRef, conversationId, messages, mountedRef, offlineMode, searchQuery, searching]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchResults([]);
    setSearchCompleted(false);
  }, []);

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    setSearching,
    searchCompleted,
    runSearch,
    closeSearch,
    setSearchResults,
    setSearchCompleted,
  };
}
