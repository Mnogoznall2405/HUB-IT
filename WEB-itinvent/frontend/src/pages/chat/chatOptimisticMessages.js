import { withPreservedThreadRenderKey } from './chatThreadMessages';

export function buildReplyPreview(message) {
  const messageId = String(message?.id || '').trim();
  if (!messageId) return null;
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const kind = message?.kind === 'task_share'
    ? 'task_share'
    : (message?.kind === 'file' || attachments.length > 0 ? 'file' : 'text');
  const senderName = String(message?.sender?.full_name || message?.sender?.username || '').trim() || 'Сообщение';
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

export function withStableThreadMessageRenderKey(message, existingMessage = null) {
  return withPreservedThreadRenderKey(message, existingMessage);
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
