import { useCallback, useEffect, useState } from 'react';

import { chatAPI } from '../../api/client';

// The server sends snake_case previews; the thread bar and the context menu use camelCase.
export function normalizePinnedPreviews(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: String(item?.id || '').trim(),
      senderName: String(item?.sender_name ?? item?.senderName ?? '').trim(),
      preview: String(item?.preview || '').trim(),
      createdAt: String(item?.created_at ?? item?.createdAt ?? '').trim(),
    }))
    .filter((item) => item.id);
}

// All pins of the open conversation (newest first). The list is refetched whenever the conversation's
// newest pin or its change time moves, so pins of other managers arrive through the usual realtime update.
export default function useChatPinnedMessages({
  activeConversationId,
  serverPinnedMessageId,
  serverPinnedAt,
  persistPinnedMessage,
}) {
  const [pinned, setPinned] = useState({ conversationId: '', items: [] });
  const conversationId = String(activeConversationId || '').trim();
  const hasPins = Boolean(String(serverPinnedMessageId || '').trim());

  useEffect(() => {
    if (!conversationId || !hasPins) {
      setPinned((current) => (current.items.length === 0 ? current : { conversationId, items: [] }));
      return undefined;
    }
    let cancelled = false;
    chatAPI.getPinnedMessages(conversationId)
      .then((data) => {
        if (cancelled) return;
        setPinned({ conversationId, items: normalizePinnedPreviews(data?.items) });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [conversationId, hasPins, serverPinnedMessageId, serverPinnedAt]);

  const applyPinnedMessages = useCallback((items) => {
    const normalized = normalizePinnedPreviews(items);
    setPinned({ conversationId, items: normalized });
    persistPinnedMessage?.(normalized[0] || null);
  }, [conversationId, persistPinnedMessage]);

  return {
    pinnedMessages: pinned.conversationId === conversationId ? pinned.items : [],
    applyPinnedMessages,
  };
}
