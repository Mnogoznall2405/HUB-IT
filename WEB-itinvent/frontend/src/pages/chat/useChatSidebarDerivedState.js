import { useMemo } from 'react';

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

  const draftsByConversation = useMemo(
    () => buildDraftsByConversationMap({
      conversations,
      activeConversationId,
      deferredMessageText,
      userId,
    }),
    [activeConversationId, conversations, deferredMessageText, userId],
  );

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
