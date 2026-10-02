import { useCallback, useEffect, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';
import { getChatConfigCached } from '../../api/chatConfig';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import { matchesPersonQuery, sortByName } from './chatHelpers';

const DEFAULT_SEARCH_DEBOUNCE_MS = 250;

// Д2-9: fallback лимита группы, если GET /chat/config недоступен (404/сеть).
export const CHAT_GROUP_MAX_MEMBERS_FALLBACK = 128;

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

// Сброс module-level кеша для unit-тестов.
export function resetChatGroupUsersCache() {
  _cachedUsers = null;
  _cacheTs = 0;
}

// Д2-9: поток «карандаш» — состояние «'' | 'direct' | 'group'» и выбор
// участников группы. На десктопе поток заменяет список чатов в левой колонке,
// на телефоне занимает весь экран. Лимит участников приходит из
// GET /chat/config (group_max_members уже включает создателя группы).
export default function useChatGroupDialog({
  isMobile,
  loadConversationsRef,
  notifyApiError,
  notifyInfo,
  openMobileThreadViewRef,
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  setActiveConversationId,
}) {
  const skipNextGroupSearchRef = useRef(false);
  const [composeFlow, setComposeFlow] = useState('');
  const [groupStep, setGroupStep] = useState('members');
  const [groupTitle, setGroupTitle] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupUsers, setGroupUsers] = useState([]);
  const [groupUsersLoading, setGroupUsersLoading] = useState(false);
  const [groupSelectedUsers, setGroupSelectedUsers] = useState([]);
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [groupMaxMembers, setGroupMaxMembers] = useState(CHAT_GROUP_MAX_MEMBERS_FALLBACK);
  const [creatingConversation, setCreatingConversation] = useState(false);

  const resetGroupDialogState = useCallback(() => {
    setGroupTitle('');
    setGroupSearch('');
    setGroupUsers([]);
    setGroupSelectedUsers([]);
    setGroupMemberIds([]);
  }, []);

  const ensureChatConfig = useCallback(() => {
    if (!CHAT_FEATURE_ENABLED) return;
    getChatConfigCached()
      .then((data) => {
        const parsed = Number(data?.group_max_members);
        if (Number.isFinite(parsed) && parsed > 0) {
          setGroupMaxMembers((current) => (current === parsed ? current : parsed));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    ensureChatConfig();
  }, [ensureChatConfig]);

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
      let sorted = sortByName(Array.isArray(data?.items) ? data.items : []);
      // Д2-9: сервер ищет по ФИО/логину/почте; подмешиваем локальные совпадения
      // по должности/подразделению/городу из кеша полного списка.
      if (!isEmptyQuery && Array.isArray(_cachedUsers) && _cachedUsers.length) {
        const known = new Set(sorted.map((item) => Number(item?.id || 0)));
        const extra = _cachedUsers.filter((item) => (
          !known.has(Number(item?.id || 0)) && matchesPersonQuery(item, query)
        ));
        if (extra.length) sorted = sortByName([...sorted, ...extra]);
      }
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
    if (!composeFlow) return undefined;
    // Первый прогон после открытия: список уже загружен openComposeFlow —
    // повторный пустой запрос пропускаем, но флаг сбрасываем в любом случае.
    if (skipNextGroupSearchRef.current) {
      skipNextGroupSearchRef.current = false;
      if (!String(groupSearch || '').trim()) return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      void loadGroupUsers(groupSearch);
    }, searchDebounceMs);
    return () => window.clearTimeout(timeoutId);
  }, [composeFlow, groupSearch, loadGroupUsers, searchDebounceMs]);

  // Бэкенд добавляет создателя к множеству участников перед проверкой лимита —
  // поэтому из каталога можно выбрать максимум group_max_members - 1 человек.
  const groupSelectableLimit = Number.isFinite(groupMaxMembers) && groupMaxMembers > 0
    ? Math.max(0, groupMaxMembers - 1)
    : null;
  const selectionLimitReached = groupSelectableLimit != null
    && groupMemberIds.length >= groupSelectableLimit;

  const addGroupMember = useCallback((userItem) => {
    const normalizedUserId = Number(userItem?.id || 0);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return;
    setGroupSelectedUsers((current) => {
      if (current.some((item) => Number(item?.id || 0) === normalizedUserId)) {
        return current;
      }
      if (groupSelectableLimit != null && current.length >= groupSelectableLimit) {
        return current;
      }
      // Порядок выбора (не алфавитный): Backspace в поиске снимает последний чип.
      return [...current, userItem];
    });
    setGroupMemberIds((current) => {
      const nextIds = new Set(normalizeGroupMemberIds(current));
      if (nextIds.has(normalizedUserId)) return [...nextIds];
      if (groupSelectableLimit != null && nextIds.size >= groupSelectableLimit) {
        return [...nextIds];
      }
      nextIds.add(normalizedUserId);
      return [...nextIds];
    });
  }, [groupSelectableLimit]);

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

  const closeComposeFlow = useCallback(() => {
    if (creatingConversation) return;
    setComposeFlow('');
    setGroupStep('members');
    resetGroupDialogState();
  }, [creatingConversation, resetGroupDialogState]);

  const openComposeFlow = useCallback((mode) => {
    const normalizedMode = mode === 'group' ? 'group' : 'direct';
    setGroupTitle('');
    setGroupSearch('');
    setGroupSelectedUsers([]);
    setGroupMemberIds([]);
    setGroupStep('members');
    if (_cachedUsers && (Date.now() - _cacheTs) < CACHE_TTL_MS) {
      setGroupUsers(_cachedUsers);
    } else {
      setGroupUsers([]);
    }
    skipNextGroupSearchRef.current = true;
    setComposeFlow(normalizedMode);
    // Повторная попытка после неудачного первого запроса — кеш сам сбрасывается.
    ensureChatConfig();
    void loadGroupUsers('');
  }, [ensureChatConfig, loadGroupUsers]);

  const openGroupDialog = useCallback(() => {
    openComposeFlow('group');
  }, [openComposeFlow]);

  const openDirectFlow = useCallback(() => {
    openComposeFlow('direct');
  }, [openComposeFlow]);

  const createGroup = useCallback(async (avatarFile = null) => {
    const title = String(groupTitle || '').trim();
    const memberIds = normalizeGroupMemberIds(groupMemberIds);
    if (!title || memberIds.length < 2) return;
    // Понятный отказ до отправки: лимит считается вместе с создателем группы.
    if (groupSelectableLimit != null && memberIds.length > groupSelectableLimit) {
      const maxTotal = groupSelectableLimit + 1;
      notifyInfo?.(
        `В группе может быть не более ${maxTotal} участников (включая вас). Выберите не более ${groupSelectableLimit}.`,
      );
      return;
    }
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
      setComposeFlow('');
      setGroupStep('members');
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
    groupSelectableLimit,
    groupTitle,
    isMobile,
    loadConversationsRef,
    notifyApiError,
    notifyInfo,
    openMobileThreadViewRef,
    resetGroupDialogState,
    setActiveConversationId,
  ]);

  return {
    addGroupMember,
    closeComposeFlow,
    composeFlow,
    createGroup,
    creatingConversation,
    groupCreateDisabled: creatingConversation
      || !String(groupTitle || '').trim()
      || groupMemberIds.length < 2
      || (groupSelectableLimit != null && groupMemberIds.length > groupSelectableLimit),
    groupMaxMembers,
    groupMemberIds,
    groupSearch,
    groupSelectableLimit,
    groupSelectedUsers,
    groupStep,
    groupTitle,
    groupUsers,
    groupUsersLoading,
    openDirectFlow,
    openGroupDialog,
    patchGroupPresence,
    removeGroupMember,
    selectionLimitReached,
    setGroupSearch,
    setGroupStep,
    setGroupTitle,
  };
}
