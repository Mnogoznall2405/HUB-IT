import { useMemo, useRef } from 'react';

import { buildChatDraftKey } from '../../components/chat/chatHelpers';
import {
  buildFolderUnreadCounts,
  filterSidebarConversationsByFolder,
} from '../../components/chat/chatFolderUtils';
import { buildAiSidebarRows } from './chatAiModel';

export function sumConversationUnreadTotal(conversations = []) {
  return conversations.reduce((sum, item) => sum + Number(item?.unread_count || 0), 0);
}

export function buildDraftsByConversationMap({
  conversations,
  activeConversationId,
  deferredMessageText,
  userId,
  readLocalStorageItem = typeof window !== 'undefined' && window.localStorage
    ? window.localStorage.getItem.bind(window.localStorage)
    : undefined,
} = {}) {
  const drafts = {};
  (Array.isArray(conversations) ? conversations : []).forEach((item) => {
    const conversationId = String(item?.id || '').trim();
    if (!conversationId) return;
    const storageKey = buildChatDraftKey(userId, conversationId);
    let value = '';
    if (conversationId === activeConversationId) {
      value = String(deferredMessageText || '').trim();
    } else if (storageKey) {
      try {
        value = String(readLocalStorageItem?.(storageKey) || '').trim();
      } catch {
        value = '';
      }
    }
    if (value) drafts[conversationId] = value;
  });
  return drafts;
}

export function buildStoredDraftsByConversationMap({
  conversationIds,
  userId,
  readLocalStorageItem = typeof window !== 'undefined' && window.localStorage
    ? window.localStorage.getItem.bind(window.localStorage)
    : undefined,
} = {}) {
  const drafts = {};
  (Array.isArray(conversationIds) ? conversationIds : []).forEach((conversationIdValue) => {
    const conversationId = String(conversationIdValue || '').trim();
    const storageKey = buildChatDraftKey(userId, conversationId);
    if (!conversationId || !storageKey) return;
    try {
      const value = String(readLocalStorageItem?.(storageKey) || '').trim();
      if (value) drafts[conversationId] = value;
    } catch {
      // Ignore browser storage failures for draft previews.
    }
  });
  return drafts;
}

export function applyActiveConversationDraft({
  drafts,
  activeConversationId,
  deferredMessageText,
} = {}) {
  const conversationId = String(activeConversationId || '').trim();
  if (!conversationId) return drafts || {};
  const currentDrafts = drafts || {};
  const nextValue = String(deferredMessageText || '').trim();
  const currentValue = String(currentDrafts[conversationId] || '').trim();
  if (currentValue === nextValue) return currentDrafts;
  const nextDrafts = { ...currentDrafts };
  if (nextValue) nextDrafts[conversationId] = nextValue;
  else delete nextDrafts[conversationId];
  return nextDrafts;
}

export function collectWatchedPresenceUserIds({
  activeConversation,
  conversations,
  groupSelectedUsers,
  groupUsers,
  messageReadsItems,
  searchChats,
  searchPeople,
} = {}) {
  const result = new Set();
  const addPerson = (person) => {
    const personId = Number(person?.id || person?.user?.id || 0);
    if (Number.isFinite(personId) && personId > 0) {
      result.add(personId);
    }
  };
  const addConversationPeople = (conversation) => {
    if (!conversation || typeof conversation !== 'object') return;
    addPerson(conversation?.direct_peer);
    (Array.isArray(conversation?.member_preview) ? conversation.member_preview : []).forEach((member) => addPerson(member?.user || member));
    (Array.isArray(conversation?.members) ? conversation.members : []).forEach((member) => addPerson(member?.user || member));
  };

  conversations.slice(0, 20).forEach(addConversationPeople);
  searchChats.slice(0, 10).forEach(addConversationPeople);
  addConversationPeople(activeConversation);
  searchPeople.slice(0, 10).forEach(addPerson);
  groupUsers.slice(0, 10).forEach(addPerson);
  groupSelectedUsers.slice(0, 10).forEach(addPerson);
  messageReadsItems.slice(0, 10).forEach((item) => addPerson(item?.user));

  return Array.from(result).slice(0, 50);
}

export default function useChatSidebarDerivedState({
  activeConversation,
  activeConversationId,
  aiBots,
  conversationFilter,
  conversationIdsByFolder,
  conversations,
  customFolders,
  deferredMessageText,
  groupSelectedUsers,
  groupUsers,
  messageReadsItems,
  searchChats,
  searchPeople,
  userId,
}) {
  const draftCacheRef = useRef({ scopeKey: '', userId: '', drafts: {} });
  const unreadTotal = useMemo(
    () => sumConversationUnreadTotal(conversations),
    [conversations],
  );

  const conversationFilterCounts = useMemo(
    () => buildFolderUnreadCounts(conversations, customFolders, conversationIdsByFolder),
    [conversationIdsByFolder, conversations, customFolders],
  );

  const filteredConversations = useMemo(
    () => filterSidebarConversationsByFolder(conversations, conversationFilter, conversationIdsByFolder),
    [conversationFilter, conversationIdsByFolder, conversations],
  );

  const watchedPresenceUserIds = useMemo(
    () => collectWatchedPresenceUserIds({
      activeConversation,
      conversations,
      groupSelectedUsers,
      groupUsers,
      messageReadsItems,
      searchChats,
      searchPeople,
    }),
    [activeConversation, conversations, groupSelectedUsers, groupUsers, messageReadsItems, searchChats, searchPeople],
  );

  const watchedPresenceUserIdsKey = useMemo(
    () => [...watchedPresenceUserIds].sort((left, right) => left - right).join(','),
    [watchedPresenceUserIds],
  );

  const conversationIdsKey = useMemo(
    () => JSON.stringify((Array.isArray(conversations) ? conversations : [])
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean)),
    [conversations],
  );
  const normalizedDraftUserId = String(userId || 'guest').trim() || 'guest';
  const draftScopeKey = `${normalizedDraftUserId}:${conversationIdsKey}`;
  const storedDraftsByConversation = useMemo(
    () => buildStoredDraftsByConversationMap({
      conversationIds: JSON.parse(conversationIdsKey),
      userId,
    }),
    [conversationIdsKey, userId],
  );

  if (draftCacheRef.current.scopeKey !== draftScopeKey) {
    const previousCache = draftCacheRef.current;
    const nextDrafts = { ...storedDraftsByConversation };
    if (previousCache.userId === normalizedDraftUserId) {
      JSON.parse(conversationIdsKey).forEach((conversationId) => {
        if (Object.prototype.hasOwnProperty.call(previousCache.drafts, conversationId)) {
          nextDrafts[conversationId] = previousCache.drafts[conversationId];
        }
      });
    }
    draftCacheRef.current = {
      scopeKey: draftScopeKey,
      userId: normalizedDraftUserId,
      drafts: nextDrafts,
    };
  }

  const draftsByConversation = useMemo(() => {
    const nextDrafts = applyActiveConversationDraft({
      drafts: draftCacheRef.current.drafts,
      activeConversationId,
      deferredMessageText,
    });
    draftCacheRef.current.drafts = nextDrafts;
    return nextDrafts;
  }, [activeConversationId, deferredMessageText, draftScopeKey]);

  const aiSidebarRows = useMemo(
    () => buildAiSidebarRows({
      aiBots,
      conversations,
      draftsByConversation,
      activeConversationId,
    }),
    [activeConversationId, aiBots, conversations, draftsByConversation],
  );

  return {
    aiSidebarRows,
    conversationFilterCounts,
    draftsByConversation,
    filteredConversations,
    unreadTotal,
    watchedPresenceUserIds,
    watchedPresenceUserIdsKey,
  };
}
