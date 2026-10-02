import {
  areThreadMessagesEquivalent,
  normalizeThreadMessageClientId,
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
    liveAppear = false,
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
      if (itemId === messageId || (normalizedReplaceId && itemId === normalizedReplaceId)) {
        return true;
      }
      // A server echo of an optimistic bubble (sending or failed) replaces it
      // by client_message_id — isLikelyOptimisticReplacement only covers
      // 'sending', so 'failed' bubbles would duplicate without this.
      if (item?.isOptimistic) {
        const itemClientId = normalizeThreadMessageClientId(item);
        const incomingClientId = normalizeThreadMessageClientId(message);
        if (itemClientId && incomingClientId && itemClientId === incomingClientId) return true;
      }
      return false;
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

    // U3: only genuinely new live inserts get the appear animation; merges into
    // an existing row (server ACK, edits, reads) keep the mounted node anyway.
    next.push(withStableMessageRenderKey(
      liveAppear ? { ...message, animateAppear: true } : message,
    ));
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
