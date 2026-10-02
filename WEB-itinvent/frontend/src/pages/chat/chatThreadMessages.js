const isOptimisticThreadMessageId = (messageId) => String(messageId || '').trim().startsWith('optimistic:');
const EMPTY_ACTIVE_THREAD_MESSAGES = Object.freeze([]);

export const resolveActiveThreadRenderState = ({
  activeConversationId,
  hydratedConversationId,
  messages,
  messagesLoading = false,
} = {}) => {
  const normalizedActiveId = String(activeConversationId || '').trim();
  const normalizedHydratedId = String(hydratedConversationId || '').trim();
  const hydrated = Boolean(normalizedActiveId && normalizedActiveId === normalizedHydratedId);
  return {
    messages: hydrated && Array.isArray(messages) ? messages : EMPTY_ACTIVE_THREAD_MESSAGES,
    loading: Boolean(normalizedActiveId && (!hydrated || messagesLoading)),
  };
};

export const normalizeThreadMessageId = (message) => String(message?.id || '').trim();

export const normalizeThreadMessageClientId = (message) => String(message?.client_message_id || '').trim();

// Key-order-insensitive stringify for server payload objects whose exact
// render-relevant shape is not fixed (forward_preview, action_card, variants).
const stableSignatureStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableSignatureStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableSignatureStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

const buildThreadMessageSignature = (message) => {
  if (!message || typeof message !== 'object') return '';
  const sender = message?.sender || {};
  const replyPreview = message?.reply_preview || {};
  const taskPreview = message?.task_preview || {};
  const poll = message?.poll && typeof message.poll === 'object' ? message.poll : null;
  const reactions = Array.isArray(message?.reactions) ? message.reactions : [];
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
    is_deleted: Boolean(message?.is_deleted),
    deleted_at: String(message?.deleted_at || '').trim(),
    conversation_seq: Number(message?.conversation_seq || 0),
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
    poll: poll ? {
      question: String(poll.question || '').trim(),
      options: (Array.isArray(poll.options) ? poll.options : []).map((option) => ({
        text: String(option?.text || '').trim(),
        votes: Number(option?.votes) || 0,
      })),
      anonymous: Boolean(poll.anonymous),
      closed: Boolean(poll.closed),
      total_voters: Number(poll.total_voters) || 0,
      my_option_index: Number.isInteger(Number(poll.my_option_index))
        ? Number(poll.my_option_index)
        : null,
    } : null,
    reactions: reactions.map((reaction) => ({
      emoji: String(reaction?.emoji || '').trim(),
      count: Number(reaction?.count || 0),
      user_ids: (Array.isArray(reaction?.user_ids) ? reaction.user_ids : [])
        .map((userId) => String(userId ?? '').trim())
        .filter(Boolean)
        .sort(),
    })),
    action_card: message?.action_card && typeof message.action_card === 'object'
      ? stableSignatureStringify(message.action_card)
      : '',
    forward_preview: message?.forward_preview && typeof message.forward_preview === 'object'
      ? stableSignatureStringify(message.forward_preview)
      : '',
    attachments: attachments.map((attachment) => ({
      id: String(attachment?.id || '').trim(),
      file_name: String(attachment?.file_name || '').trim(),
      file_size: Number(attachment?.file_size || 0),
      mime_type: String(attachment?.mime_type || '').trim(),
      kind: String(attachment?.kind || attachment?.media_kind || '').trim(),
      width: Number(attachment?.width || 0),
      height: Number(attachment?.height || 0),
      duration_seconds: Number(attachment?.duration_seconds || attachment?.durationSeconds || 0),
      variant_urls: attachment?.variant_urls && typeof attachment.variant_urls === 'object'
        ? stableSignatureStringify(attachment.variant_urls)
        : '',
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

export const isFailedOptimisticThreadMessage = (message, conversationId = '') => {
  const normalizedConversationId = String(conversationId || '').trim();
  if (!message?.isOptimistic) return false;
  if (String(message?.optimisticStatus || '').trim() !== 'failed') return false;
  if (!normalizedConversationId) return true;
  return String(message?.conversation_id || '').trim() === normalizedConversationId;
};

const threadMessageConversationSeq = (message) => {
  const seq = Number(message?.conversation_seq);
  return Number.isFinite(seq) && seq > 0 ? seq : 0;
};

const isOptimisticThreadMessage = (message) => (
  Boolean(message?.isOptimistic) || isOptimisticThreadMessageId(message?.id)
);

export const compareThreadMessagePosition = (left, right) => {
  const leftSeq = threadMessageConversationSeq(left);
  const rightSeq = threadMessageConversationSeq(right);
  if (leftSeq > 0 && rightSeq > 0 && leftSeq !== rightSeq) return leftSeq - rightSeq;
  // Optimistic bubbles carry no conversation_seq yet: keep them after
  // persisted messages so a refresh can't interleave them into history.
  const leftOptimistic = isOptimisticThreadMessage(left);
  const rightOptimistic = isOptimisticThreadMessage(right);
  if (leftOptimistic !== rightOptimistic) return leftOptimistic ? 1 : -1;
  const leftDate = Date.parse(String(left?.created_at || ''));
  const rightDate = Date.parse(String(right?.created_at || ''));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
    return leftDate - rightDate;
  }
  if (Number.isFinite(leftDate) !== Number.isFinite(rightDate)) {
    return Number.isFinite(leftDate) ? -1 : 1;
  }
  return String(left?.id || '').localeCompare(String(right?.id || ''));
};

export const sortThreadMessages = (messages) => (
  [...messages].sort(compareThreadMessagePosition)
);

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
    if (clientMessageId && (
      isSendingOptimisticThreadMessage(item, conversationId)
      || isFailedOptimisticThreadMessage(item, conversationId)
    )) {
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

  // Failed bubbles survive every refresh; the server echo (same
  // client_message_id) replaces them through the map above.
  current.forEach((message) => {
    if (!isFailedOptimisticThreadMessage(message, conversationId)) return;
    const clientMessageId = normalizeThreadMessageClientId(message);
    if (clientMessageId && serverClientIds.has(clientMessageId)) return;
    const messageId = normalizeThreadMessageId(message);
    if (messageId && next.some((item) => normalizeThreadMessageId(item) === messageId)) return;
    next.push(message);
  });

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
