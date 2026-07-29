import { useMemo } from 'react';

import { canDeleteChatMessage, getMessagePreview } from '../../components/chat/chatHelpers';

export default function useChatMessageSelection({
  conversationKind,
  messages,
  selectedMessageIds,
}) {
  const selectedMessageIdSet = useMemo(
    () => new Set((Array.isArray(selectedMessageIds) ? selectedMessageIds : []).map((value) => String(value || '').trim()).filter(Boolean)),
    [selectedMessageIds],
  );

  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageIdSet.has(String(message?.id || '').trim())),
    [messages, selectedMessageIdSet],
  );

  const selectedVisibleMessageIds = useMemo(
    () => selectedMessages.map((message) => String(message?.id || '').trim()).filter(Boolean),
    [selectedMessages],
  );

  const selectedMessageCount = selectedMessages.length;

  const canCopySelectedMessages = useMemo(
    () => selectedMessages.some((message) => String(getMessagePreview(message) || '').trim()),
    [selectedMessages],
  );

  const canDeleteSelectedMessages = useMemo(
    () => selectedMessages.length > 0
      && selectedMessages.every((message) => canDeleteChatMessage(message, { conversationKind })),
    [conversationKind, selectedMessages],
  );

  return {
    canCopySelectedMessages,
    canDeleteSelectedMessages,
    selectedMessageCount,
    selectedMessages,
    selectedMessageIdSet,
    selectedVisibleMessageIds,
  };
}
