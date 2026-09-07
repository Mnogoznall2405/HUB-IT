const DELIVERY_STATUS_RANK = {
  sending: 1,
  sent: 2,
  read: 3,
};

function isLeanServerThreadMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (String(message.payload_mode || '').trim() === 'lean') return true;
  if (message._lean === true) return true;
  const username = String(message?.sender?.username || '').trim();
  const fullName = String(message?.sender?.full_name || '').trim();
  return Boolean(username.startsWith('user-') && !fullName);
}

function preferDeliveryStatus(existingStatus, incomingStatus) {
  const left = String(existingStatus || '').trim();
  const right = String(incomingStatus || '').trim();
  if (!right) return left || undefined;
  if (!left) return right;
  const leftRank = DELIVERY_STATUS_RANK[left] || 0;
  const rightRank = DELIVERY_STATUS_RANK[right] || 0;
  return rightRank >= leftRank ? right : left;
}

/**
 * Merge server ACK / message.created / message.updated into a local thread row.
 * Lean ACK must not wipe optimistic sender, reply preview or a newer delivery status.
 */
export function mergeIncomingThreadMessage(existingMessage, incomingMessage) {
  if (!incomingMessage?.id) return incomingMessage;
  if (!existingMessage) {
    const next = { ...incomingMessage };
    if (next.isOptimistic) {
      next.isOptimistic = false;
      delete next.optimisticStatus;
    }
    return next;
  }

  const lean = isLeanServerThreadMessage(incomingMessage);
  const merged = {
    ...existingMessage,
    ...incomingMessage,
  };

  const existingSender = existingMessage.sender && typeof existingMessage.sender === 'object'
    ? existingMessage.sender
    : null;
  const incomingSender = incomingMessage.sender && typeof incomingMessage.sender === 'object'
    ? incomingMessage.sender
    : null;
  if (lean && existingSender && (existingSender.full_name || existingSender.username)) {
    merged.sender = existingSender;
  } else if (
    existingSender
    && incomingSender
    && !String(incomingSender.full_name || '').trim()
    && String(existingSender.full_name || '').trim()
  ) {
    merged.sender = {
      ...incomingSender,
      ...existingSender,
      id: incomingSender.id || existingSender.id,
    };
  }

  if ((incomingMessage.reply_preview == null || incomingMessage.reply_preview === undefined)
    && existingMessage.reply_preview) {
    merged.reply_preview = existingMessage.reply_preview;
  }
  if (lean) {
    const existingAttachments = Array.isArray(existingMessage.attachments) ? existingMessage.attachments : [];
    const incomingAttachments = Array.isArray(incomingMessage.attachments) ? incomingMessage.attachments : [];
    if (existingAttachments.length > 0 && incomingAttachments.length === 0) {
      merged.attachments = existingAttachments;
    }
  }

  merged.delivery_status = preferDeliveryStatus(
    existingMessage.delivery_status,
    incomingMessage.delivery_status,
  );
  merged.isOptimistic = false;
  delete merged.optimisticStatus;
  delete merged._lean;
  return merged;
}

export function resolveServerMessageFromSendAck(response, {
  conversationId = '',
  optimisticMessage = null,
} = {}) {
  const payload = response && typeof response === 'object' ? response : {};
  const nested = payload.message && typeof payload.message === 'object' ? payload.message : null;
  const messageId = String(nested?.id || payload.message_id || '').trim();
  if (!messageId) return null;

  const leanCandidate = {
    ...(nested || {}),
    id: messageId,
    conversation_id: String(
      nested?.conversation_id
      || payload.conversation_id
      || conversationId
      || ''
    ).trim(),
    client_message_id: String(
      nested?.client_message_id
      || payload.client_message_id
      || optimisticMessage?.client_message_id
      || ''
    ).trim() || undefined,
    created_at: String(nested?.created_at || payload.created_at || '').trim()
      || optimisticMessage?.created_at,
    conversation_seq: Number(nested?.conversation_seq ?? payload.seq ?? 0) || 0,
    delivery_status: String(nested?.delivery_status || payload.status || 'sent').trim() || 'sent',
    is_own: nested?.is_own !== undefined ? Boolean(nested.is_own) : true,
    body: nested?.body !== undefined ? nested.body : optimisticMessage?.body,
    body_format: nested?.body_format || optimisticMessage?.body_format || 'plain',
    kind: nested?.kind || optimisticMessage?.kind || 'text',
    payload_mode: nested?.payload_mode || (payload.ok === true ? 'lean' : nested?.payload_mode),
  };

  return mergeIncomingThreadMessage(optimisticMessage, leanCandidate);
}

