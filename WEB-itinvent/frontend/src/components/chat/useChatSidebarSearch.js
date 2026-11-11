import { useCallback, useEffect, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';
import { sortByName } from './chatHelpers';

export default function useChatSidebarSearch({
  notifyApiError,
  searchDebounceMs = 250,
} = {}) {
  const searchVersionRef = useRef(0);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [searchingSidebar, setSearchingSidebar] = useState(false);
  const [searchPeople, setSearchPeople] = useState([]);
  const [searchChats, setSearchChats] = useState([]);

  const resetSidebarSearch = useCallback(() => {
    searchVersionRef.current += 1;
    setSidebarQuery('');
    setSearchPeople([]);
    setSearchChats([]);
    setSearchingSidebar(false);
  }, []);

  const upsertSearchConversation = useCallback((conversation) => {
    const normalizedConversationId = String(conversation?.id || '').trim();
    if (!normalizedConversationId) return;
    setSearchChats((current) => current.map((item) => (
      item.id === normalizedConversationId ? conversation : item
    )));
  }, []);

  const patchSearchConversations = useCallback((mapper) => {
    if (typeof mapper !== 'function') return;
    setSearchChats((current) => current.map(mapper));
  }, []);

  const patchSearchPersonPresence = useCallback((userId, presence) => {
    const normalizedUserId = Number(userId || 0);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return;
    setSearchPeople((current) => current.map((item) => (
      Number(item?.id || 0) === normalizedUserId
        ? {
            ...item,
            presence,
          }
        : item
    )));
  }, []);

  const runSidebarSearch = useCallback(async (query, searchVersion) => {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      if (searchVersionRef.current !== searchVersion) return;
      setSearchPeople([]);
      setSearchChats([]);
      setSearchingSidebar(false);
      return;
    }
    setSearchingSidebar(true);
    try {
      const [usersResponse, conversationsResponse] = await Promise.all([
        chatAPI.getUsers({ q: normalizedQuery, limit: 12 }),
        chatAPI.getConversations({ q: normalizedQuery, limit: 20 }),
      ]);
      if (searchVersionRef.current !== searchVersion) return;
      setSearchPeople(sortByName(Array.isArray(usersResponse?.items) ? usersResponse.items : []));
      setSearchChats(Array.isArray(conversationsResponse?.items) ? conversationsResponse.items : []);
    } catch (error) {
      if (searchVersionRef.current !== searchVersion) return;
      notifyApiError?.(error, 'Не удалось выполнить поиск по людям и чатам.');
      setSearchPeople([]);
      setSearchChats([]);
    } finally {
      if (searchVersionRef.current === searchVersion) {
        setSearchingSidebar(false);
      }
    }
  }, [notifyApiError]);

  useEffect(() => {
    searchVersionRef.current += 1;
    const searchVersion = searchVersionRef.current;
    const timeoutId = window.setTimeout(() => {
      void runSidebarSearch(sidebarQuery, searchVersion);
    }, searchDebounceMs);
    return () => window.clearTimeout(timeoutId);
  }, [runSidebarSearch, searchDebounceMs, sidebarQuery]);

  const sidebarSearchActive = Boolean(String(sidebarQuery || '').trim());
  const searchResultEmpty = sidebarSearchActive && !searchingSidebar && searchPeople.length === 0 && searchChats.length === 0;

  return {
    patchSearchConversations,
    patchSearchPersonPresence,
    resetSidebarSearch,
    searchChats,
    searchPeople,
    searchResultEmpty,
    searchingSidebar,
    setSidebarQuery,
    sidebarQuery,
    sidebarSearchActive,
    upsertSearchConversation,
  };
}
