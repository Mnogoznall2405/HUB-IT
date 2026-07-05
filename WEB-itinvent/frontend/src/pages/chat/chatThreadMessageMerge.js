import {
  areThreadMessagesEquivalent,
  sortThreadMessages,
} from './chatThreadMessages';

export function removeThreadMessageFromList(messages, messageId) {
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedMessageId) return Array.isArray(messages) ? messages : [];
  const current = Array.isArray(messages) ? messages : [];
  return current.filter((item) => String(item?.id || '').trim() !== normalizedMessageId);
}

export function upsertThreadMessagesInList(
  current,
  incomingMessages,
  {
    activeConversationId = '',
    replaceByMessageId = null,
    withStableMessageRenderKey = (message) => message,
  } = {},
) {
  const sourceMessages = (Array.isArray(incomingMessages) ? incomingMessages : [incomingMessages])
    .filter((message) => {
      const normalizedConversationId = String(message?.conversation_id || '').trim();
      return message?.id && normalizedConversationId && normalizedConversationId === activeConversationId;
    });
  if (sourceMessages.length === 0) return current;

  const replacementMap = replaceByMessageId instanceof Map ? replaceByMessageId : new Map();
  const base = Array.isArray(current) ? current : [];
  let next = [...base];
  let changed = false;

  sourceMessages.forEach((message) => {
    const messageId = String(message?.id || '').trim();
    const normalizedReplaceId = String(replacementMap.get(messageId) || '').trim();
    if (!messageId) return;

    const existingIndex = next.findIndex((item) => {
      const itemId = String(item?.id || '').trim();
      return itemId === messageId || (normalizedReplaceId && itemId === normalizedReplaceId);
    });

    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      const nextMessage = withStableMessageRenderKey(message, existing);
      if (!areThreadMessagesEquivalent(existing, nextMessage)) {
        next[existingIndex] = nextMessage;
        changed = true;
      }
      if (String(existing?.id || '').trim() !== messageId) {
        changed = true;
      }
      if (normalizedReplaceId) {
        const beforeLength = next.length;
        next = next.filter((item, index) => (
          index === existingIndex || String(item?.id || '').trim() !== normalizedReplaceId
        ));
        if (next.length !== beforeLength) changed = true;
      }
      return;
    }

    next.push(withStableMessageRenderKey(message));
    changed = true;
  });

  const ordered = sortThreadMessages(next);
  if (!changed && ordered.length === base.length) {
    for (let index = 0; index < ordered.length; index += 1) {
      if (ordered[index] !== base[index]) {
        changed = true;
        break;
      }
    }
  }
  return changed ? ordered : base;
}

export function resolveThreadMessageMerge(
  message,
  currentMessages,
  {
    isLikelyOptimisticReplacement,
    withStableMessageRenderKey,
  } = {},
) {
  if (!message?.id) return null;
  const current = Array.isArray(currentMessages) ? currentMessages : [];
  const optimisticMatch = current.find((item) => isLikelyOptimisticReplacement?.(item, message));
  if (optimisticMatch?.id) {
    return {
      message: withStableMessageRenderKey?.(message, optimisticMatch) || message,
      replaceId: optimisticMatch.id,
    };
  }
  return {
    message: withStableMessageRenderKey?.(message) || message,
    replaceId: '',
  };
}
