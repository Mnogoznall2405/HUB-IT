import { useCallback, useMemo } from 'react';

import { chatAPI } from '../../api/client';
import {
  buildMentionCandidates,
  mergeActiveConversation,
  resolveActiveConversationSummary,
} from './chatActiveConversationModel';

export default function useChatActiveConversation({
  activeConversationId,
  conversationDetailsById,
  conversations,
  searchChats,
  searchPeople,
  userId,
}) {
  const activeConversationSummary = useMemo(
    () => resolveActiveConversationSummary({
      activeConversationId,
      conversations,
      searchChats,
    }),
    [activeConversationId, conversations, searchChats],
  );

  const activeConversation = useMemo(
    () => mergeActiveConversation({
      activeConversationId,
      activeConversationSummary,
      conversationDetailsById,
    }),
    [activeConversationId, activeConversationSummary, conversationDetailsById],
  );

  const mentionCandidates = useMemo(
    () => buildMentionCandidates({
      activeConversation,
      currentUserId: Number(userId || 0),
      searchPeople,
    }),
    [activeConversation, searchPeople, userId],
  );

  const searchMentionPeople = useCallback(async (query) => {
    const normalizedQuery = String(query || '').trim().replace(/^@+/, '');
    if (!normalizedQuery) return [];
    const response = await chatAPI.getUsers({ q: normalizedQuery, limit: 8 });
    return Array.isArray(response?.items) ? response.items : [];
  }, []);

  return {
    activeConversation,
    activeConversationSummary,
    mentionCandidates,
    searchMentionPeople,
  };
}
