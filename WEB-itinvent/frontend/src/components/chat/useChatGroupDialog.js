import { useCallback, useEffect, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import { sortByName } from './chatHelpers';

const DEFAULT_SEARCH_DEBOUNCE_MS = 250;

// Module-level cache: показываем мгновенно при повторном открытии
let _cachedUsers = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

const normalizeGroupMemberIds = (values) => (
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
  )]
);

export default function useChatGroupDialog({
  isMobile,
  loadChatDialogsModule,
  loadConversationsRef,
  notifyApiError,
  openMobileThreadViewRef,
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  setActiveConversationId,
}) {
  const skipNextGroupSearchRef = useRef(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupUsers, setGroupUsers] = useState([]);
  const [groupUsersLoading, setGroupUsersLoading] = useState(false);
  const [groupSelectedUsers, setGroupSelectedUsers] = useState([]);
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [creatingConversation, setCreatingConversation] = useState(false);

  const resetGroupDialogState = useCallback(() => {
    setGroupTitle('');
    setGroupSearch('');
    setGroupUsers([]);
    setGroupSelectedUsers([]);
    setGroupMemberIds([]);
  }, []);

  const loadGroupUsers = useCallback(async (query = '') => {
    if (!CHAT_FEATURE_ENABLED) return;
    const isEmptyQuery = !String(query || '').trim();
    // Показываем кеш мгновенно для пустого запроса
    if (isEmptyQuery && _cachedUsers && (Date.now() - _cacheTs) < CACHE_TTL_MS) {
      setGroupUsers(_cachedUsers);
      setGroupUsersLoading(false);
      // Обновляем в фоне без спиннера
      chatAPI.getUsers({ q: '', limit: 200 })
        .then((data) => {
          const sorted = sortByName(Array.isArray(data?.items) ? data.items : []);
          _cachedUsers = sorted;
          _cacheTs = Date.now();
          setGroupUsers(sorted);
        })
        .catch(() => {});
      return;
    }
    setGroupUsersLoading(true);
    try {
      const data = await chatAPI.getUsers({ q: query, limit: 200 });
      const sorted = sortByName(Array.isArray(data?.items) ? data.items : []);
      if (isEmptyQuery) {
        _cachedUsers = sorted;
        _cacheTs = Date.now();
      }
      setGroupUsers(sorted);
    } catch (error) {
      setGroupUsers([]);
      notifyApiError(error, 'Не удалось загрузить пользователей для группового чата.');
    } finally {
      setGroupUsersLoading(false);
    }
  }, [notifyApiError]);

  useEffect(() => {
    if (!groupOpen) return undefined;
    if (!String(groupSearch || '').trim() && skipNextGroupSearchRef.current) {
      skipNextGroupSearchRef.current = false;
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      void loadGroupUsers(groupSearch);
    }, searchDebounceMs);
    return () => window.clearTimeout(timeoutId);
  }, [groupOpen, groupSearch, loadGroupUsers, searchDebounceMs]);

  const addGroupMember = useCallback((userItem) => {
    const normalizedUserId = Number(userItem?.id || 0);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return;
    setGroupSelectedUsers((current) => {
      if (current.some((item) => Number(item?.id || 0) === normalizedUserId)) {
        return current;
      }
      return sortByName([...current, userItem]);
    });
    setGroupMemberIds((current) => {
      const nextIds = new Set(normalizeGroupMemberIds(current));
      nextIds.add(normalizedUserId);
      return [...nextIds];
    });
  }, []);

  const removeGroupMember = useCallback((userId) => {
    const normalizedUserId = Number(userId || 0);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return;
    setGroupSelectedUsers((current) => current.filter((item) => Number(item?.id || 0) !== normalizedUserId));
    setGroupMemberIds((current) => current.filter((value) => Number(value) !== normalizedUserId));
  }, []);

  const patchGroupPresence = useCallback((userId, presence) => {
    const normalizedUserId = Number(userId || 0);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return;
    const patchUser = (item) => (
      Number(item?.id || 0) === normalizedUserId
        ? {
            ...item,
            presence,
          }
        : item
    );
    setGroupUsers((current) => current.map(patchUser));
    setGroupSelectedUsers((current) => current.map(patchUser));
  }, []);

  const closeGroupDialog = useCallback(() => {
    if (creatingConversation) return;
    setGroupOpen(false);
    resetGroupDialogState();
  }, [creatingConversation, resetGroupDialogState]);

  const openGroupDialog = useCallback(() => {
    void loadChatDialogsModule();
    setGroupTitle('');
    setGroupSearch('');
    setGroupSelectedUsers([]);
    setGroupMemberIds([]);
    if (_cachedUsers && (Date.now() - _cacheTs) < CACHE_TTL_MS) {
      setGroupUsers(_cachedUsers);
    } else {
      setGroupUsers([]);
    }
    skipNextGroupSearchRef.current = true;
    setGroupOpen(true);
    void loadGroupUsers('');
  }, [loadChatDialogsModule, loadGroupUsers]);

  const createGroup = useCallback(async (avatarFile = null) => {
    const title = String(groupTitle || '').trim();
    const memberIds = normalizeGroupMemberIds(groupMemberIds);
    if (!title || memberIds.length < 2) return;
    setCreatingConversation(true);
    try {
      const created = await chatAPI.createGroupConversation({ title, member_user_ids: memberIds });
      if (avatarFile && created?.id) {
        try {
          await chatAPI.uploadGroupAvatar(created.id, avatarFile);
        } catch {
          // avatar upload failure is non-critical
        }
      }
      setGroupOpen(false);
      resetGroupDialogState();
      const loadConversations = loadConversationsRef?.current;
      const items = typeof loadConversations === 'function'
        ? await loadConversations({ silent: true, force: true })
        : [];
      const createdId = String(created?.id || '').trim();
      const nextConversationId = items.find((item) => item.id === createdId)?.id || createdId || '';
      setActiveConversationId(nextConversationId);
      if (isMobile) {
        openMobileThreadViewRef?.current?.(nextConversationId);
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось создать групповой чат.');
    } finally {
      setCreatingConversation(false);
    }
  }, [
    groupMemberIds,
    groupTitle,
    isMobile,
    loadConversationsRef,
    notifyApiError,
    openMobileThreadViewRef,
    resetGroupDialogState,
    setActiveConversationId,
  ]);

  return {
    addGroupMember,
    closeGroupDialog,
    createGroup,
    creatingConversation,
    groupCreateDisabled: creatingConversation || !String(groupTitle || '').trim() || groupMemberIds.length < 2,
    groupMemberIds,
    groupOpen,
    groupSearch,
    groupSelectedUsers,
    groupTitle,
    groupUsers,
    groupUsersLoading,
    openGroupDialog,
    patchGroupPresence,
    removeGroupMember,
    setGroupSearch,
    setGroupTitle,
  };
}
