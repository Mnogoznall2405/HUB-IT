const isOptimisticThreadMessageId = (messageId) => String(messageId || '').trim().startsWith('optimistic:');

export const normalizeThreadMessageId = (message) => String(message?.id || '').trim();

const normalizeThreadMessageClientId = (message) => String(message?.client_message_id || '').trim();

const buildThreadMessageSignature = (message) => {
  if (!message || typeof message !== 'object') return '';
  const sender = message?.sender || {};
  const replyPreview = message?.reply_preview || {};
  const taskPreview = message?.task_preview || {};
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  return JSON.stringify({
    id: normalizeThreadMessageId(message),
    conversation_id: String(message?.conversation_id || '').trim(),
    client_message_id: normalizeThreadMessageClientId(message),
    kind: String(message?.kind || '').trim(),
    body_format: String(message?.body_format || '').trim(),
    body: String(message?.body || ''),
    created_at: String(message?.created_at || '').trim(),
    edited_at: String(message?.edited_at || '').trim(),
    delivery_status: String(message?.delivery_status || '').trim(),
    read_by_count: Number(message?.read_by_count || 0),
    is_own: Boolean(message?.is_own),
    isOptimistic: Boolean(message?.isOptimistic),
    optimisticStatus: String(message?.optimisticStatus || '').trim(),
    uploadProgress: Number(message?.uploadProgress || 0),
    renderKey: String(message?.renderKey || message?.render_key || '').trim(),
    sender: {
      id: String(sender?.id || '').trim(),
      username: String(sender?.username || '').trim(),
      full_name: String(sender?.full_name || '').trim(),
    },
    reply_preview: {
      id: String(replyPreview?.id || '').trim(),
      kind: String(replyPreview?.kind || '').trim(),
      body: String(replyPreview?.body || '').trim(),
      task_title: String(replyPreview?.task_title || '').trim(),
      attachments_count: Number(replyPreview?.attachments_count || 0),
    },
    task_preview: {
      id: String(taskPreview?.id || '').trim(),
      title: String(taskPreview?.title || '').trim(),
      status: String(taskPreview?.status || '').trim(),
    },
    attachments: attachments.map((attachment) => ({
      id: String(attachment?.id || '').trim(),
      file_name: String(attachment?.file_name || '').trim(),
      file_size: Number(attachment?.file_size || 0),
      mime_type: String(attachment?.mime_type || '').trim(),
      original_url: String(attachment?.original_url || attachment?.originalUrl || '').trim(),
      preview_url: String(attachment?.preview_url || attachment?.previewUrl || '').trim(),
      poster_url: String(attachment?.poster_url || attachment?.posterUrl || '').trim(),
    })),
  });
};

export const areThreadMessagesEquivalent = (left, right) => (
  left === right
  || (
    normalizeThreadMessageId(left)
    && normalizeThreadMessageId(left) === normalizeThreadMessageId(right)
    && buildThreadMessageSignature(left) === buildThreadMessageSignature(right)
  )
);

export const hasPersistedThreadMessageEquivalent = (messages, message) => {
  const list = Array.isArray(messages) ? messages : [];
  if (!message || typeof message !== 'object') return false;
  const targetId = normalizeThreadMessageId(message);
  const targetClientId = normalizeThreadMessageClientId(message);
  return list.some((item) => {
    if (!item || item?.isOptimistic || isOptimisticThreadMessageId(item?.id)) return false;
    if (areThreadMessagesEquivalent(item, message)) return true;
    if (targetId && normalizeThreadMessageId(item) === targetId) return true;
    if (targetClientId && normalizeThreadMessageClientId(item) === targetClientId) return true;
    return false;
  });
};

export const withPreservedThreadRenderKey = (message, existingMessage = null) => {
  if (!message?.id) return message;
  const nextRenderKey = String(
    existingMessage?.renderKey
    || existingMessage?.render_key
    || message?.renderKey
    || message?.render_key
    || message?.id
    || ''
  ).trim();
  if (!nextRenderKey || String(message?.renderKey || '').trim() === nextRenderKey) return message;
  return {
    ...message,
    renderKey: nextRenderKey,
  };
};

export const isSendingOptimisticThreadMessage = (message, conversationId = '') => {
  const normalizedConversationId = String(conversationId || '').trim();
  if (!message?.isOptimistic) return false;
  if (String(message?.optimisticStatus || '').trim() !== 'sending') return false;
  if (!normalizedConversationId) return true;
  return String(message?.conversation_id || '').trim() === normalizedConversationId;
};

export const sortThreadMessages = (messages) => (
  [...messages].sort((left, right) => {
    const createdDiff = String(left?.created_at || '').localeCompare(String(right?.created_at || ''));
    if (createdDiff !== 0) return createdDiff;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  })
);

export const compareThreadMessagePosition = (left, right) => {
  const createdDiff = String(left?.created_at || '').localeCompare(String(right?.created_at || ''));
  if (createdDiff !== 0) return createdDiff;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
};

const shouldPreserveFreshLocalThreadMessage = ({
  message,
  conversationId = '',
  incomingIds,
  incomingLastMessage,
}) => {
  const normalizedMessageId = normalizeThreadMessageId(message);
  if (!normalizedMessageId || incomingIds.has(normalizedMessageId)) return false;
  if (message?.isOptimistic) return false;
  const normalizedConversationId = String(conversationId || '').trim();
  if (normalizedConversationId && String(message?.conversation_id || '').trim() !== normalizedConversationId) return false;
  if (!incomingLastMessage?.id) return false;
  return compareThreadMessagePosition(message, incomingLastMessage) > 0;
};

const shouldPreserveLoadedOlderThreadMessage = ({
  message,
  conversationId = '',
  incomingIds,
  incomingFirstMessage,
}) => {
  const normalizedMessageId = normalizeThreadMessageId(message);
  if (!normalizedMessageId || incomingIds.has(normalizedMessageId)) return false;
  if (message?.isOptimistic) return false;
  const normalizedConversationId = String(conversationId || '').trim();
  if (normalizedConversationId && String(message?.conversation_id || '').trim() !== normalizedConversationId) return false;
  if (!incomingFirstMessage?.id) return false;
  return compareThreadMessagePosition(message, incomingFirstMessage) < 0;
};

export const reconcileThreadMessages = (currentMessages, incomingMessages, {
  conversationId = '',
  preserveSendingOptimistic = false,
  mode = 'replace',
} = {}) => {
  const current = Array.isArray(currentMessages) ? currentMessages : [];
  const incoming = Array.isArray(incomingMessages) ? incomingMessages.filter((item) => item?.id) : [];
  const currentById = new Map(current.map((item) => [normalizeThreadMessageId(item), item]));
  const incomingIds = new Set(incoming.map((item) => normalizeThreadMessageId(item)).filter(Boolean));
  const currentOptimisticByClientId = new Map();
  current.forEach((item) => {
    const clientMessageId = normalizeThreadMessageClientId(item);
    if (clientMessageId && isSendingOptimisticThreadMessage(item, conversationId)) {
      currentOptimisticByClientId.set(clientMessageId, item);
    }
  });

  const serverClientIds = new Set();
  const next = incoming.map((message) => {
    const messageId = normalizeThreadMessageId(message);
    const clientMessageId = normalizeThreadMessageClientId(message);
    if (clientMessageId) serverClientIds.add(clientMessageId);
    const existing = currentById.get(messageId)
      || (clientMessageId ? currentOptimisticByClientId.get(clientMessageId) : null)
      || null;
    const nextMessage = withPreservedThreadRenderKey(message, existing);
    return areThreadMessagesEquivalent(existing, nextMessage) ? existing : nextMessage;
  });

  if (String(mode || '').trim() === 'replaceWindowButPreserveFreshLocal') {
    const sortedIncoming = sortThreadMessages(incoming);
    const incomingLastMessage = sortedIncoming.at(-1) || null;
    const incomingFirstMessage = sortedIncoming.at(0) || null;
    current.forEach((message) => {
      if (shouldPreserveFreshLocalThreadMessage({
        message,
        conversationId,
        incomingIds,
        incomingLastMessage,
      })) {
        next.push(message);
        return;
      }
      if (shouldPreserveLoadedOlderThreadMessage({
        message,
        conversationId,
        incomingIds,
        incomingFirstMessage,
      })) {
        next.push(message);
      }
    });
  }

  if (preserveSendingOptimistic) {
    current.forEach((message) => {
      const clientMessageId = normalizeThreadMessageClientId(message);
      if (!isSendingOptimisticThreadMessage(message, conversationId)) return;
      if (clientMessageId && serverClientIds.has(clientMessageId)) return;
      if (next.some((item) => normalizeThreadMessageId(item) === normalizeThreadMessageId(message))) return;
      next.push(message);
    });
  }

  const ordered = sortThreadMessages(next);
  if (ordered.length !== current.length) return ordered;
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index] !== current[index]) return ordered;
  }
  return current;
};

export const getLatestPersistedThreadMessageId = (messages) => {
  const items = Array.isArray(messages) ? messages : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidateId = String(items[index]?.id || '').trim();
    if (candidateId && !isOptimisticThreadMessageId(candidateId)) {
      return candidateId;
    }
  }
  return '';
};

export const buildThreadPrefetchQueue = (
  conversations,
  activeConversationId,
  {
    limit = 6,
  } = {},
) => {
  const items = Array.isArray(conversations) ? conversations : [];
  const normalizedActiveConversationId = String(activeConversationId || '').trim();
  const maxItems = Math.max(0, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 0);
  if (maxItems <= 0) return [];

  const seen = new Set();
  const queue = [];
  const addConversation = (conversation) => {
    const conversationId = String(conversation?.id || '').trim();
    if (!conversationId || conversationId === normalizedActiveConversationId || seen.has(conversationId)) return;
    if (conversation?.is_archived) return;
    seen.add(conversationId);
    queue.push(conversationId);
  };

  const activeIndex = normalizedActiveConversationId
    ? items.findIndex((item) => String(item?.id || '').trim() === normalizedActiveConversationId)
    : -1;
  if (activeIndex >= 0) {
    addConversation(items[activeIndex + 1]);
    addConversation(items[activeIndex - 1]);
  }

  for (const item of items) {
    if (queue.length >= maxItems) break;
    addConversation(item);
  }

  return queue.slice(0, maxItems);
};

export const normalizeForwardMessageQueue = (messages) => {
  const source = Array.isArray(messages) ? messages : [messages];
  const seenIds = new Set();
  return source.filter((message) => {
    const messageId = String(message?.id || '').trim();
    if (!messageId || seenIds.has(messageId)) return false;
    seenIds.add(messageId);
    return true;
  });
};
