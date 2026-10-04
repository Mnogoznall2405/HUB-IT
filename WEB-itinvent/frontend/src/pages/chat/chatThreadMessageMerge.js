import {
  areThreadMessagesEquivalent,
  normalizeThreadMessageClientId,
  sortThreadMessages,
} from './chatThreadMessages';

// A row produced on this client (optimistic send / failed / retry), as opposed
// to a server copy (ACK, message.created, history page).
function isLocalOptimisticThreadMessage(message) {
  return Boolean(message?.isOptimistic || message?.optimisticStatus);
}

// Client ids of rows the server has confirmed (persisted copies).
export function collectPersistedThreadClientIds(messages) {
  const ids = new Set();
  (Array.isArray(messages) ? messages : []).forEach((item) => {
    if (!item || isLocalOptimisticThreadMessage(item)) return;
    const clientId = normalizeThreadMessageClientId(item);
    if (clientId) ids.add(clientId);
  });
  return ids;
}

// Failed-bubble registry (conversationId → Map<optimisticId, entry>): drop the
// entries the server already persisted so a thread refresh never restores
// them next to the server copy. Returns the number of removed entries.
export function pruneFailedThreadMessagesRegistry(registry, conversationId, persistedClientIds) {
  const normalizedConversationId = String(conversationId || '').trim();
  if (!registry || typeof registry.get !== 'function' || !normalizedConversationId) return 0;
  const byConversation = registry.get(normalizedConversationId);
  if (!byConversation?.size || !persistedClientIds?.size) return 0;
  let removed = 0;
  Array.from(byConversation.entries()).forEach(([failedId, entry]) => {
    const clientId = String(entry?.clientMessageId || entry?.message?.client_message_id || '').trim();
    if (clientId && persistedClientIds.has(clientId)) {
      byConversation.delete(failedId);
      removed += 1;
    }
  });
  return removed;
}

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

    const incomingClientId = normalizeThreadMessageClientId(message);
    const incomingIsLocalOptimistic = isLocalOptimisticThreadMessage(message);
    // A local optimistic status update (sending → failed, retry) must never
    // resurrect a bubble the server copy already replaced: the persisted row
    // with the same client_message_id wins regardless of event order.
    if (incomingIsLocalOptimistic && incomingClientId && next.some((item) => (
      !isLocalOptimisticThreadMessage(item)
      && normalizeThreadMessageClientId(item) === incomingClientId
    ))) {
      return;
    }

    // Same-client rows: the exact id first, then the explicit replace target,
    // then an optimistic bubble (sending or failed) with the same
    // client_message_id — isLikelyOptimisticReplacement only covers 'sending',
    // so 'failed' bubbles would duplicate without the last rule.
    const isSameClientOptimisticRow = (item) => {
      if (!incomingClientId || !item?.isOptimistic) return false;
      return normalizeThreadMessageClientId(item) === incomingClientId;
    };
    let existingIndex = next.findIndex((item) => String(item?.id || '').trim() === messageId);
    if (existingIndex < 0 && normalizedReplaceId) {
      existingIndex = next.findIndex((item) => String(item?.id || '').trim() === normalizedReplaceId);
    }
    if (existingIndex < 0) {
      existingIndex = next.findIndex(isSameClientOptimisticRow);
    }

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
      // Invariant: one row per message id / client_message_id. Drop the
      // replace target and, for a server copy, every other local bubble of
      // the same send (and stray rows with the same id) — whatever order the
      // ACK, message.created, HTTP answer and history pages arrived in.
      const beforeLength = next.length;
      next = next.filter((item, index) => {
        if (index === existingIndex) return true;
        const itemId = String(item?.id || '').trim();
        if (itemId === messageId) return false;
        if (normalizedReplaceId && itemId === normalizedReplaceId) return false;
        if (!incomingIsLocalOptimistic && isSameClientOptimisticRow(item)) return false;
        return true;
      });
      if (next.length !== beforeLength) changed = true;
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
