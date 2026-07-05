import { useCallback } from 'react';

import {
  applyReadReceiptDeltaToMessages,
  countUnreadIncomingAfterMarker,
  getMessageIndexById,
  getMessagePreview,
  sortSidebarConversations,
} from '../../components/chat/chatHelpers';

export function patchConversationWithPresence(conversation, userId, presence) {
  const normalizedUserId = Number(userId || 0);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !presence) {
    return conversation;
  }
  if (!conversation || typeof conversation !== 'object') return conversation;

  let changed = false;
  const nextConversation = { ...conversation };

  if (conversation?.kind === 'direct' && Number(conversation?.direct_peer?.id || 0) === normalizedUserId) {
    nextConversation.direct_peer = { ...conversation.direct_peer, presence };
    changed = true;
  }

  if (Array.isArray(conversation?.members)) {
    const nextMembers = conversation.members.map((member) => {
      if (Number(member?.user?.id || 0) !== normalizedUserId) return member;
      changed = true;
      return {
        ...member,
        user: {
          ...member.user,
          presence,
        },
      };
    });
    nextConversation.members = nextMembers;
  }

  if (Array.isArray(conversation?.member_preview)) {
    const nextMemberPreview = conversation.member_preview.map((member) => {
      if (Number(member?.user?.id || 0) !== normalizedUserId) return member;
      changed = true;
      return {
        ...member,
        user: {
          ...member.user,
          presence,
        },
      };
    });
    nextConversation.member_preview = nextMemberPreview;
  }

  return changed ? nextConversation : conversation;
}

export default function useChatConversationSyncCallbacks({
  messagesRef,
  patchGroupPresence,
  patchSearchConversations,
  patchSearchPersonPresence,
  setConversationDetailsById,
  setConversations,
  setMessageReadsItems,
  setMessages,
  upsertSearchConversation,
}) {
  const syncConversationPreview = useCallback((conversationId, lastMessage, overrides = {}) => {
    const id = String(conversationId || '').trim();
    if (!id || !lastMessage) return;
    setConversations((current) => current.map((item) => (
      item.id === id
        ? {
            ...item,
            last_message_at: lastMessage?.created_at || item.last_message_at,
            updated_at: lastMessage?.created_at || item.updated_at,
            last_message_preview: getMessagePreview(lastMessage),
            last_message_is_own: Boolean(lastMessage?.is_own),
            last_message_delivery_status: lastMessage?.is_own
              ? (String(lastMessage?.delivery_status || '').trim() || 'sent')
              : null,
            ...overrides,
          }
        : item
    )));
  }, [setConversations]);

  const syncConversationUnreadState = useCallback((conversationId, readMessageId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const normalizedReadMessageId = String(readMessageId || '').trim();
    if (!normalizedConversationId) return;
    const nextUnreadCount = countUnreadIncomingAfterMarker(messagesRef.current, normalizedReadMessageId);
    setConversations((current) => current.map((item) => (
      item.id === normalizedConversationId
        ? {
            ...item,
            unread_count: nextUnreadCount,
          }
        : item
    )));
  }, [messagesRef, setConversations]);

  const promoteConversationToTop = useCallback(() => {
    setConversations((current) => sortSidebarConversations(current));
  }, [setConversations]);

  const patchThreadMessage = useCallback((messageId, patch) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId || !patch || typeof patch !== 'object') return;
    setMessages((current) => current.map((item) => (
      String(item?.id || '').trim() === normalizedMessageId
        ? { ...item, ...patch }
        : item
    )));
  }, [setMessages]);

  const upsertConversation = useCallback((conversation, { promote = false } = {}) => {
    if (!conversation?.id) return;
    const normalizedConversationId = String(conversation.id).trim();
    setConversations((current) => {
      const index = current.findIndex((item) => item.id === normalizedConversationId);
      const next = index >= 0
        ? current.map((item) => (item.id === normalizedConversationId ? conversation : item))
        : [conversation, ...current];
      return sortSidebarConversations(next);
    });
    upsertSearchConversation(conversation);
    setConversationDetailsById((current) => {
      const existing = current[normalizedConversationId];
      if (!existing) return current;
      return {
        ...current,
        [normalizedConversationId]: {
          ...existing,
          ...conversation,
          member_preview: Array.isArray(conversation?.member_preview)
            ? conversation.member_preview
            : (existing.member_preview || []),
          members: Array.isArray(conversation?.members) ? conversation.members : existing.members,
        },
      };
    });
  }, [setConversationDetailsById, setConversations, upsertSearchConversation]);

  const applyMessageReadDelta = useCallback((payload) => {
    const messageId = String(payload?.message_id || '').trim();
    if (!messageId) return;
    const list = Array.isArray(messagesRef.current) ? messagesRef.current : [];
    const readIndex = getMessageIndexById(list, messageId);
    const lastIndex = list.length - 1;
    const lastMessage = lastIndex >= 0 ? list[lastIndex] : null;
    const conversationId = String(lastMessage?.conversation_id || '').trim();
    const nextReadByCount = Number(payload?.read_by_count);
    const nextDeliveryStatus = String(payload?.delivery_status || '').trim();
    const markAsRead = nextDeliveryStatus === 'read'
      || (Number.isFinite(nextReadByCount) && nextReadByCount > 0);

    setMessages((current) => applyReadReceiptDeltaToMessages(current, payload));

    if (
      markAsRead
      && conversationId
      && lastMessage?.is_own
      && readIndex >= 0
      && readIndex >= lastIndex
    ) {
      setConversations((current) => current.map((item) => (
        item.id === conversationId && item.kind === 'direct' && item.last_message_is_own
          ? {
              ...item,
              last_message_delivery_status: 'read',
            }
          : item
      )));
    }
  }, [messagesRef, setConversations, setMessages]);

  const updatePresenceInCollections = useCallback((userId, presence) => {
    const normalizedUserId = Number(userId || 0);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !presence) return;

    setConversations((current) => current.map(
      (conversation) => patchConversationWithPresence(conversation, normalizedUserId, presence),
    ));
    setConversationDetailsById((current) => Object.fromEntries(
      Object.entries(current).map(([conversationId, conversation]) => [
        conversationId,
        patchConversationWithPresence(conversation, normalizedUserId, presence),
      ]),
    ));
    patchSearchConversations((conversation) => patchConversationWithPresence(
      conversation,
      normalizedUserId,
      presence,
    ));
    patchSearchPersonPresence(normalizedUserId, presence);
    patchGroupPresence(normalizedUserId, presence);
    setMessageReadsItems((current) => current.map((item) => (
      Number(item?.user?.id || 0) === normalizedUserId
        ? {
            ...item,
            user: {
              ...item.user,
              presence,
            },
          }
        : item
    )));
  }, [
    patchGroupPresence,
    patchSearchConversations,
    patchSearchPersonPresence,
    setConversationDetailsById,
    setConversations,
    setMessageReadsItems,
  ]);

  return {
    applyMessageReadDelta,
    patchThreadMessage,
    promoteConversationToTop,
    syncConversationPreview,
    syncConversationUnreadState,
    updatePresenceInCollections,
    upsertConversation,
  };
}
