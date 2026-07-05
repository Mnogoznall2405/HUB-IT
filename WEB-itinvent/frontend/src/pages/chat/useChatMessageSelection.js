import { useMemo } from 'react';

import { getMessagePreview } from '../../components/chat/chatHelpers';

export default function useChatMessageSelection({
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

  return {
    canCopySelectedMessages,
    selectedMessageCount,
    selectedMessages,
    selectedMessageIdSet,
    selectedVisibleMessageIds,
  };
}
