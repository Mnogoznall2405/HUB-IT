import { withPreservedThreadRenderKey } from './chatThreadMessages';

export function buildReplyPreview(message) {
  const messageId = String(message?.id || '').trim();
  if (!messageId) return null;
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const kind = message?.kind === 'task_share'
    ? 'task_share'
    : (message?.kind === 'file' || attachments.length > 0 ? 'file' : 'text');
  const fullName = String(message?.sender?.full_name || '').trim();
  const username = String(message?.sender?.username || '').trim();
  const senderName = fullName
    || (username && !/^user-\d+$/i.test(username) ? username : '')
    || 'Участник';
  const body = String(message?.body || '').trim();
  const taskTitle = String(message?.task_preview?.title || '').trim();
  return {
    id: messageId,
    sender_name: senderName,
    kind,
    body,
    task_title: taskTitle || undefined,
    attachments_count: attachments.length,
  };
}

export function isLikelyOptimisticReplacement(optimisticMessage, serverMessage) {
  if (!optimisticMessage?.id || !serverMessage?.id) return false;
  if (!optimisticMessage?.isOptimistic) return false;
  if (String(optimisticMessage?.optimisticStatus || '').trim() !== 'sending') return false;
  if (!serverMessage?.is_own) return false;
  if (String(optimisticMessage?.conversation_id || '').trim() !== String(serverMessage?.conversation_id || '').trim()) {
    return false;
  }
  if (String(optimisticMessage?.kind || 'text').trim() !== String(serverMessage?.kind || 'text').trim()) {
    return false;
  }

  const optimisticClientMessageId = String(optimisticMessage?.client_message_id || '').trim();
  const serverClientMessageId = String(serverMessage?.client_message_id || '').trim();
  if (optimisticClientMessageId && serverClientMessageId) {
    return optimisticClientMessageId === serverClientMessageId;
  }

  const optimisticReplyId = String(optimisticMessage?.reply_preview?.id || '').trim();
  const serverReplyId = String(
    serverMessage?.reply_preview?.id
    || serverMessage?.reply_to_message_id
    || ''
  ).trim();
  if (optimisticReplyId && serverReplyId && optimisticReplyId !== serverReplyId) {
    return false;
  }

  const optimisticBody = String(optimisticMessage?.body || '').trim();
  const serverBody = String(serverMessage?.body || '').trim();
  if (optimisticBody !== serverBody) return false;

  const optimisticAttachments = Array.isArray(optimisticMessage?.attachments) ? optimisticMessage.attachments : [];
  const serverAttachments = Array.isArray(serverMessage?.attachments) ? serverMessage.attachments : [];
  if (optimisticAttachments.length !== serverAttachments.length) return false;
  if (optimisticAttachments.length > 0) {
    const optimisticNames = optimisticAttachments.map((item) => String(item?.file_name || '').trim()).join('|');
    const serverNames = serverAttachments.map((item) => String(item?.file_name || '').trim()).join('|');
    if (optimisticNames && serverNames && optimisticNames !== serverNames) return false;
  }

  const optimisticCreatedAt = Date.parse(String(optimisticMessage?.created_at || ''));
  const serverCreatedAt = Date.parse(String(serverMessage?.created_at || ''));
  if (Number.isFinite(optimisticCreatedAt) && Number.isFinite(serverCreatedAt)) {
    return Math.abs(serverCreatedAt - optimisticCreatedAt) <= 30_000;
  }

  return true;
}

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

export function withStableThreadMessageRenderKey(message, existingMessage = null) {
  const merged = existingMessage
    ? mergeIncomingThreadMessage(existingMessage, message)
    : message;
  return withPreservedThreadRenderKey(merged, existingMessage);
}

export function revokeOptimisticObjectUrls(urls) {
  if (!Array.isArray(urls) || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  urls.forEach((value) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return;
    try {
      URL.revokeObjectURL(normalizedValue);
    } catch {
      // Ignore object URL cleanup failures.
    }
  });
}

export function buildOptimisticFileMessage({
  conversationId,
  files,
  mediaKinds = [],
  body,
  replyPreview,
  user,
  seq,
  now = Date.now(),
}) {
  const normalizedConversationId = String(conversationId || '').trim();
  const sourceFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!normalizedConversationId || sourceFiles.length === 0) return null;
  const normalizedSeq = Number(seq) || 0;
  const canCreateObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const objectUrls = [];
  const attachments = sourceFiles.map((file, index) => {
    const objectUrl = canCreateObjectUrl ? URL.createObjectURL(file) : '';
    const mediaKind = String(mediaKinds?.[index] || '').trim().toLowerCase();
    if (objectUrl) objectUrls.push(objectUrl);
    return {
      id: `optimistic-attachment:${now}:${normalizedSeq}:${index + 1}`,
      file_name: String(file?.name || '').trim() || `file-${index + 1}`,
      file_size: Number(file?.size || 0),
      mime_type: String(file?.type || '').trim() || 'application/octet-stream',
      original_url: objectUrl,
      open_url: objectUrl,
      preview_url: objectUrl,
      poster_url: '',
      ...(mediaKind ? { kind: mediaKind, media_kind: mediaKind } : {}),
      ...(String(file?.type || '').startsWith('image/')
        ? { width: 216, height: 176 }
        : {}),
    };
  });
  const optimisticId = `optimistic:${normalizedConversationId}:file:${now}:${normalizedSeq}`;
  return {
    id: optimisticId,
    conversation_id: normalizedConversationId,
    kind: 'file',
    sender: {
      id: Number(user?.id || 0) || user?.id || 0,
      username: String(user?.username || '').trim(),
      full_name: String(user?.full_name || user?.username || '').trim() || null,
    },
    body: String(body || '').trim(),
    created_at: new Date(now).toISOString(),
    is_own: true,
    delivery_status: 'sending',
    read_by_count: 0,
    reply_preview: replyPreview || null,
    task_preview: null,
    attachments,
    isOptimistic: true,
    optimisticStatus: 'sending',
    uploadProgress: 0,
    optimisticObjectUrls: objectUrls,
    renderKey: optimisticId,
  };
}

export function buildOptimisticTextMessage({
  conversationId,
  body,
  bodyFormat = 'plain',
  replyPreview,
  user,
  seq,
  now = Date.now(),
}) {
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedBody = String(body || '').trim();
  if (!normalizedConversationId || !normalizedBody) return null;
  const normalizedBodyFormat = String(bodyFormat || '').trim() === 'markdown' ? 'markdown' : 'plain';
  const normalizedSeq = Number(seq) || 0;
  const optimisticId = `optimistic:${normalizedConversationId}:${now}:${normalizedSeq}`;
  const clientMessageId = `chat-client:${normalizedConversationId}:${now}:${normalizedSeq}`;
  return {
    id: optimisticId,
    conversation_id: normalizedConversationId,
    client_message_id: clientMessageId,
    kind: 'text',
    sender: {
      id: Number(user?.id || 0) || user?.id || 0,
      username: String(user?.username || '').trim(),
      full_name: String(user?.full_name || user?.username || '').trim() || null,
    },
    body: normalizedBody,
    body_format: normalizedBodyFormat,
    created_at: new Date(now).toISOString(),
    is_own: true,
    delivery_status: 'sending',
    read_by_count: 0,
    reply_preview: replyPreview || null,
    task_preview: null,
    attachments: [],
    isOptimistic: true,
    optimisticStatus: 'sending',
    renderKey: optimisticId,
  };
}
