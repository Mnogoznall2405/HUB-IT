import apiClient from './client';
import type { AxiosProgressEvent, AxiosRequestConfig, AxiosResponse } from 'axios';
import { subscribeAccessTokenChanges } from '../auth/tokenStore';
import type {
  ChatAiBot,
  ChatConversationSummary,
  ChatConversationPage,
  ChatMessageReadReceipt,
  ChatMessage,
  ChatMessagePage,
  ChatThreadBootstrapPage,
  ChatAttachmentPage,
  ChatConversationAttachment,
  ChatFolderListResponse,
  ChatFolderSummary,
  ChatGlobalMessageSearchHit,
  ChatStickerPack,
  ChatTaskPreview,
  ChatUserSummary,
} from './types';
import {
  normalizeChatConversation,
  normalizeChatMessage,
  normalizeChatMessagePage,
  normalizeChatReactions,
  normalizeChatThreadBootstrap,
  normalizeGlobalMessageSearchHit,
} from '../chat/chatModels';
import { detectChatBodyFormat } from '../chat/chatMarkdown';

const CHAT_TRANSIENT_READ_RETRY_DELAY_MS = 150;

async function getChatReadWithRetry<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  try {
    return await apiClient.get<T>(url, config);
  } catch (error) {
    const status = Number((error as { response?: { status?: unknown } })?.response?.status || 0);
    if (status !== 503 || config?.signal?.aborted) throw error;
    await new Promise((resolve) => setTimeout(resolve, CHAT_TRANSIENT_READ_RETRY_DELAY_MS));
    if (config?.signal?.aborted) throw error;
    return apiClient.get<T>(url, config);
  }
}

function requiredConversation(value: unknown): ChatConversationSummary {
  const item = normalizeChatConversation(value);
  if (!item) throw new Error('Сервер вернул некорректный диалог');
  return item;
}

function requiredMessage(value: unknown): ChatMessage {
  const item = normalizeChatMessage(value);
  if (!item) throw new Error('Сервер вернул некорректное сообщение');
  return item;
}

export async function getConversationPage(
  options: { query?: string; cursor?: string; limit?: number } = {},
): Promise<ChatConversationPage> {
  const { data } = await apiClient.get<{
    items?: unknown[];
    has_more?: boolean;
    next_cursor?: string | null;
  } | unknown[]>(
    '/chat/conversations',
    {
      params: {
        q: options.query || undefined,
        cursor: options.cursor || undefined,
        limit: options.limit ?? 50,
      },
    },
  );
  const items = Array.isArray(data) ? data : data.items || [];
  return {
    items: items
      .map(normalizeChatConversation)
      .filter((item): item is ChatConversationSummary => Boolean(item)),
    has_more: Array.isArray(data) ? false : Boolean(data.has_more),
    next_cursor: Array.isArray(data) ? null : String(data.next_cursor || '').trim() || null,
  };
}

export async function getConversations(): Promise<ChatConversationSummary[]> {
  return (await getConversationPage()).items;
}

export async function markConversationRead(conversationId: string, lastMessageId?: string): Promise<void> {
  const messageId = String(lastMessageId || '').trim();
  if (!messageId) return;
  await apiClient.post(`/chat/conversations/${conversationId}/read`, {
    message_id: messageId,
  });
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<ChatMessage> {
  const { data } = await apiClient.delete<unknown>(
    `/chat/conversations/${conversationId}/messages/${messageId}`,
  );
  return requiredMessage(data);
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  body: string,
): Promise<ChatMessage> {
  const { data } = await apiClient.patch<unknown>(
    `/chat/conversations/${conversationId}/messages/${messageId}`,
    { body, body_format: detectChatBodyFormat(body) },
  );
  return requiredMessage(data);
}

export async function getMessagesPage(
  conversationId: string,
  options: { beforeMessageId?: string; afterMessageId?: string; limit?: number } = {},
): Promise<ChatMessagePage> {
  const { data } = await getChatReadWithRetry<unknown>(
    `/chat/conversations/${conversationId}/messages`,
    {
      params: {
        before_message_id: options.beforeMessageId || undefined,
        after_message_id: options.afterMessageId || undefined,
        limit: options.limit ?? 80,
      },
    },
  );
  return normalizeChatMessagePage(data);
}

export async function getMessages(conversationId: string, limit = 80): Promise<ChatMessage[]> {
  return (await getMessagesPage(conversationId, { limit })).items;
}

export async function getThreadBootstrap(
  conversationId: string,
  options: { focusMessageId?: string; limit?: number; lightweight?: boolean } = {},
): Promise<ChatThreadBootstrapPage> {
  const { data } = await getChatReadWithRetry<unknown>(
    `/chat/conversations/${conversationId}/thread-bootstrap`,
    {
      params: {
        focus_message_id: options.focusMessageId || undefined,
        limit: options.limit ?? 80,
        lightweight: options.lightweight ?? false,
      },
    },
  );
  return normalizeChatThreadBootstrap(data);
}

export async function sendTextMessage(
  conversationId: string,
  bodyText: string,
  options: {
    clientMessageId?: string;
    replyToMessageId?: string;
    bodyFormat?: 'plain' | 'markdown';
    kind?: 'text' | 'location' | 'contact' | 'poll';
    signal?: AbortSignal;
  } = {},
): Promise<ChatMessage> {
  const { data } = await apiClient.post<unknown>(`/chat/conversations/${conversationId}/messages`, {
    body: bodyText,
    body_format: options.bodyFormat || detectChatBodyFormat(bodyText),
    ...(options.kind && options.kind !== 'text' ? { kind: options.kind } : {}),
    client_message_id: options.clientMessageId || undefined,
    reply_to_message_id: options.replyToMessageId || undefined,
  }, { signal: options.signal });
  return requiredMessage(data);
}

/** F-POLL: set/retract the caller's vote; returns the aggregate poll state. */
export async function voteMessagePoll(
  conversationId: string,
  messageId: string,
  optionIndex: number,
): Promise<{ action: string; poll: ChatMessage['poll'] }> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${conversationId}/messages/${messageId}/poll-vote`,
    { option_index: optionIndex },
  );
  const record = (data && typeof data === 'object' ? data : {}) as {
    action?: string;
    poll?: ChatMessage['poll'];
  };
  return { action: String(record.action || 'voted'), poll: record.poll || null };
}

/** R-POLL-2: the author stops the poll; returns the aggregate state. */
export async function closeMessagePoll(
  conversationId: string,
  messageId: string,
): Promise<{ action: string; poll: ChatMessage['poll'] }> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${conversationId}/messages/${messageId}/poll-close`,
  );
  const record = (data && typeof data === 'object' ? data : {}) as {
    action?: string;
    poll?: ChatMessage['poll'];
  };
  return { action: String(record.action || 'closed'), poll: record.poll || null };
}

export async function createDirectConversation(peerUserId: number): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<unknown>('/chat/conversations/direct', {
    peer_user_id: peerUserId,
  });
  return requiredConversation(data);
}

export async function createGroupConversation(
  title: string,
  memberUserIds: number[],
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<unknown>('/chat/conversations/group', {
    title,
    member_user_ids: memberUserIds,
  });
  return requiredConversation(data);
}

export async function getConversation(conversationId: string): Promise<ChatConversationSummary> {
  const { data } = await apiClient.get<unknown>(
    `/chat/conversations/${conversationId}`,
  );
  return requiredConversation(data);
}

export async function updateConversationSettings(
  conversationId: string,
  settings: {
    is_pinned?: boolean;
    is_muted?: boolean;
    muted_until?: string | null;
    is_archived?: boolean;
  },
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.patch<unknown>(
    `/chat/conversations/${conversationId}/settings`,
    settings,
  );
  return requiredConversation(data);
}

export async function setPinnedMessage(
  conversationId: string,
  messageId: string | null,
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.put<unknown>(
    `/chat/conversations/${conversationId}/pinned-message`,
    { message_id: messageId },
  );
  return requiredConversation(data);
}

export async function updateGroupProfile(
  conversationId: string,
  title: string,
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.patch<unknown>(
    `/chat/conversations/${conversationId}/profile`,
    { title },
  );
  return requiredConversation(data);
}

export async function addGroupMembers(
  conversationId: string,
  memberUserIds: number[],
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${conversationId}/members`,
    { member_user_ids: memberUserIds },
  );
  return requiredConversation(data);
}

export async function removeGroupMember(
  conversationId: string,
  userId: number,
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.delete<unknown>(
    `/chat/conversations/${conversationId}/members/${userId}`,
  );
  return requiredConversation(data);
}

export async function updateGroupMemberRole(
  conversationId: string,
  userId: number,
  memberRole: 'moderator' | 'member',
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.patch<unknown>(
    `/chat/conversations/${conversationId}/members/${userId}/role`,
    { member_role: memberRole },
  );
  return requiredConversation(data);
}

export async function transferGroupOwnership(
  conversationId: string,
  ownerUserId: number,
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${conversationId}/ownership`,
    { owner_user_id: ownerUserId },
  );
  return requiredConversation(data);
}

export async function leaveGroup(conversationId: string): Promise<void> {
  await apiClient.post(`/chat/conversations/${conversationId}/leave`, {});
}

export async function getMessageReads(messageId: string): Promise<ChatMessageReadReceipt[]> {
  const { data } = await apiClient.get<{ items?: ChatMessageReadReceipt[] }>(
    `/chat/messages/${messageId}/reads`,
  );
  return Array.isArray(data.items) ? data.items : [];
}

export async function getShareableTasks(
  conversationId: string,
  query = '',
): Promise<ChatTaskPreview[]> {
  const { data } = await apiClient.get<{ items?: ChatTaskPreview[] }>(
    `/chat/conversations/${conversationId}/shareable-tasks`,
    { params: { q: query || undefined } },
  );
  return Array.isArray(data.items) ? data.items : [];
}

export async function shareTask(
  conversationId: string,
  taskId: string,
  replyToMessageId?: string,
): Promise<ChatMessage> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${conversationId}/messages/task-share`,
    { task_id: taskId, reply_to_message_id: replyToMessageId || undefined },
  );
  return requiredMessage(data);
}

export async function getStickerPacks(): Promise<ChatStickerPack[]> {
  const { data } = await apiClient.get<{ items?: ChatStickerPack[] }>('/chat/sticker-packs');
  return Array.isArray(data.items) ? data.items : [];
}

export async function importStickerPack(source: string): Promise<ChatStickerPack[]> {
  const { data } = await apiClient.post<{ items?: ChatStickerPack[] }>(
    '/chat/sticker-packs/import',
    { source: String(source || '').trim() },
    { timeout: 120000 },
  );
  return Array.isArray(data.items) ? data.items : [];
}

export async function removeStickerPack(packId: string): Promise<void> {
  await apiClient.delete(`/chat/sticker-packs/${encodeURIComponent(packId)}`);
}

export async function getLinkPreview(url: string): Promise<{
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  site_name?: string | null;
}> {
  const { data } = await apiClient.get<{
    url?: string;
    title?: string | null;
    description?: string | null;
    image?: string | null;
    site_name?: string | null;
  }>('/chat/link-preview', { params: { url } });
  return {
    url: String(data.url || url),
    title: data.title,
    description: data.description,
    image: data.image,
    site_name: data.site_name,
  };
}

export async function sendSticker(
  conversationId: string,
  stickerId: string,
  replyToMessageId?: string,
): Promise<ChatMessage> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${conversationId}/messages/sticker`,
    { sticker_id: stickerId, reply_to_message_id: replyToMessageId || undefined },
  );
  return requiredMessage(data);
}

export async function saveAttachmentToMyFiles(messageId: string, attachmentId: string): Promise<void> {
  await apiClient.post(
    `/chat/messages/${messageId}/attachments/${attachmentId}/save-to-my-files`,
    {},
  );
}

export async function confirmAiAction(actionId: string): Promise<void> {
  await apiClient.post(`/chat/ai/actions/${actionId}/confirm`, {});
}

export async function cancelAiAction(actionId: string): Promise<void> {
  await apiClient.post(`/chat/ai/actions/${actionId}/cancel`, {});
}

export async function searchMessages(conversationId: string, query: string): Promise<ChatMessage[]> {
  const { data } = await apiClient.get<{ items?: unknown[] }>(
    `/chat/conversations/${conversationId}/messages/search`,
    { params: { q: query } },
  );
  return (data.items || [])
    .map(normalizeChatMessage)
    .filter((item): item is ChatMessage => Boolean(item));
}

export async function searchMessagesGlobal(
  query: string,
  limit = 20,
): Promise<ChatGlobalMessageSearchHit[]> {
  const { data } = await apiClient.get<{ items?: unknown[] }>(
    '/chat/messages/search',
    { params: { q: query, limit } },
  );
  return (data.items || [])
    .map(normalizeGlobalMessageSearchHit)
    .filter((item): item is ChatGlobalMessageSearchHit => Boolean(item));
}

export async function toggleReaction(
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<NonNullable<ChatMessage['reactions']>> {
  const { data } = await apiClient.post<{ reactions?: unknown[] }>(
    `/chat/conversations/${conversationId}/messages/${messageId}/reactions`,
    { emoji },
  );
  return normalizeChatReactions(data.reactions);
}

export async function forwardMessage(
  targetConversationId: string,
  sourceMessageId: string,
  body?: string,
): Promise<ChatMessage> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${targetConversationId}/messages/forward`, {
    source_message_id: sourceMessageId,
    body: body || undefined,
    body_format: 'plain',
  });
  return requiredMessage(data);
}

export async function sendFileMessage(
  conversationId: string,
  formData: FormData,
  options: {
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number | null) => void;
  } = {},
): Promise<ChatMessage> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${conversationId}/messages/files`,
    formData,
    {
      // Do not set Content-Type here: the apiClient interceptor clears it for
      // FormData so React Native can attach the multipart boundary.
      timeout: 5 * 60 * 1000,
      signal: options.signal,
      onUploadProgress: (event: AxiosProgressEvent) => {
        options.onProgress?.(event.loaded, event.total ?? null);
      },
    },
  );
  return requiredMessage(data);
}

export type ChatUploadSessionFile = {
  file_id: string;
  file_name: string;
  mime_type: string | null;
  media_kind: 'image' | 'video' | 'file' | 'audio' | null;
  duration_seconds: number | null;
  size: number;
  original_size: number;
  transfer_encoding: string;
  chunk_count: number;
  received_bytes: number;
  received_chunks: number[];
};
export type ChatUploadSession = {
  session_id: string;
  chunk_size_bytes: number;
  expires_at: string;
  status: string;
  message_id: string | null;
  files: ChatUploadSessionFile[];
};
export type ChatUploadSessionChunkResult = {
  session_id: string;
  file_id: string;
  chunk_index: number;
  already_present: boolean;
  received_bytes: number;
  received_chunks: number[];
  file_complete: boolean;
};

function normalizeUploadSessionFile(value: unknown): ChatUploadSessionFile | null {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const fileId = String(row.file_id || '').trim();
  if (!fileId) return null;
  const mediaKind = String(row.media_kind || '').trim();
  return {
    file_id: fileId,
    file_name: String(row.file_name || ''),
    mime_type: row.mime_type == null ? null : String(row.mime_type),
    media_kind: (['image', 'video', 'file', 'audio'].includes(mediaKind)
      ? mediaKind : null) as ChatUploadSessionFile['media_kind'],
    duration_seconds: row.duration_seconds == null ? null : Math.max(0, Number(row.duration_seconds) || 0),
    size: Math.max(0, Number(row.size) || 0),
    original_size: Math.max(0, Number(row.original_size) || 0),
    transfer_encoding: String(row.transfer_encoding || 'identity'),
    chunk_count: Math.max(0, Number(row.chunk_count) || 0),
    received_bytes: Math.max(0, Number(row.received_bytes) || 0),
    received_chunks: (Array.isArray(row.received_chunks) ? row.received_chunks : [])
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0),
  };
}

function normalizeUploadSession(value: unknown): ChatUploadSession {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const files = (Array.isArray(row.files) ? row.files : [])
    .map(normalizeUploadSessionFile)
    .filter((item): item is ChatUploadSessionFile => Boolean(item));
  return {
    session_id: String(row.session_id || '').trim(),
    chunk_size_bytes: Math.max(0, Number(row.chunk_size_bytes) || 0),
    expires_at: String(row.expires_at || ''),
    status: String(row.status || 'pending'),
    message_id: row.message_id == null ? null : String(row.message_id),
    files,
  };
}

function requiredUploadSession(value: unknown): ChatUploadSession {
  const session = normalizeUploadSession(value);
  if (!session.session_id || session.chunk_size_bytes <= 0) {
    throw new Error('Сервер вернул некорректную сессию загрузки');
  }
  return session;
}

export async function createChatUploadSession(
  conversationId: string,
  input: {
    body?: string;
    replyToMessageId?: string;
    clientMessageId?: string;
    files: Array<{
      file_name: string;
      mime_type?: string;
      media_kind?: 'image' | 'video' | 'file' | 'audio';
      duration_seconds?: number;
      size: number;
      original_size?: number;
      transfer_encoding?: 'identity' | 'gzip';
    }>;
  },
  options: { signal?: AbortSignal } = {},
): Promise<ChatUploadSession> {
  const { data } = await apiClient.post<unknown>(
    `/chat/conversations/${encodeURIComponent(conversationId)}/upload-sessions`,
    {
      body: input.body || undefined,
      reply_to_message_id: input.replyToMessageId || undefined,
      client_message_id: input.clientMessageId || undefined,
      files: input.files.map((file) => ({
        file_name: file.file_name,
        mime_type: file.mime_type || undefined,
        media_kind: file.media_kind || undefined,
        duration_seconds: file.duration_seconds ?? undefined,
        size: Math.max(1, Math.trunc(Number(file.size) || 0)),
        original_size: Math.max(1, Math.trunc(Number(file.original_size ?? file.size) || 0)),
        transfer_encoding: file.transfer_encoding || 'identity',
      })),
    },
    { signal: options.signal },
  );
  return requiredUploadSession(data);
}

export async function getChatUploadSession(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ChatUploadSession> {
  const { data } = await apiClient.get<unknown>(
    `/chat/upload-sessions/${encodeURIComponent(sessionId)}`,
    { signal: options.signal },
  );
  return requiredUploadSession(data);
}

export async function uploadChatFileChunk(
  sessionId: string,
  fileId: string,
  chunkIndex: number,
  chunk: ArrayBuffer | ArrayBufferView,
  options: {
    offset: number;
    signal?: AbortSignal;
    onUploadProgress?: (event: { loaded: number }) => void;
  },
): Promise<ChatUploadSessionChunkResult> {
  const { data } = await apiClient.put<unknown>(
    `/chat/upload-sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}/chunks/${Math.max(0, Math.trunc(chunkIndex))}`,
    chunk,
    {
      params: { offset: Math.max(0, Math.trunc(Number(options.offset) || 0)) },
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: options.signal,
      timeout: 5 * 60 * 1000,
      onUploadProgress: (event: AxiosProgressEvent) => {
        options.onUploadProgress?.({ loaded: Math.max(0, Number(event?.loaded) || 0) });
      },
    },
  );
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    session_id: String(row.session_id || sessionId),
    file_id: String(row.file_id || fileId),
    chunk_index: Math.max(0, Number(row.chunk_index) || 0),
    already_present: Boolean(row.already_present),
    received_bytes: Math.max(0, Number(row.received_bytes) || 0),
    received_chunks: (Array.isArray(row.received_chunks) ? row.received_chunks : [])
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0),
    file_complete: Boolean(row.file_complete),
  };
}

export async function completeChatUploadSession(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ChatMessage> {
  const { data } = await apiClient.post<unknown>(
    `/chat/upload-sessions/${encodeURIComponent(sessionId)}/complete`,
    null,
    { signal: options.signal },
  );
  return requiredMessage(data);
}

export async function cancelChatUploadSession(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const normalized = String(sessionId || '').trim();
  if (!normalized) return;
  await apiClient.delete(`/chat/upload-sessions/${encodeURIComponent(normalized)}`, {
    signal: options.signal,
  });
}

export async function getChatUsers(
  options: { query?: string; limit?: number } = {},
): Promise<ChatUserSummary[]> {
  const { data } = await apiClient.get<{ items?: ChatUserSummary[] } | ChatUserSummary[]>(
    '/chat/users',
    {
      params: {
        q: options.query?.trim() || undefined,
        limit: options.limit ?? 50,
      },
    },
  );
  const items = Array.isArray(data) ? data : data.items;
  return Array.isArray(items) ? items : [];
}

export async function resolveChatUser(params: {
  email?: string;
  full_name?: string;
}): Promise<ChatUserSummary> {
  const { data } = await apiClient.get<ChatUserSummary>('/chat/users/resolve', {
    params: {
      email: params.email || undefined,
      full_name: params.full_name || undefined,
    },
  });
  return data;
}

export async function listChatFolders(): Promise<ChatFolderListResponse> {
  const { data } = await apiClient.get<{
    items?: ChatFolderSummary[];
    conversation_ids_by_folder?: Record<string, string[]>;
    folder_unread_counts?: Record<string, number>;
  }>('/chat/folders');
  const items = Array.isArray(data.items) ? data.items : [];
  const folderUnreadCounts = data.folder_unread_counts && typeof data.folder_unread_counts === 'object'
    ? Object.fromEntries(
      Object.entries(data.folder_unread_counts).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]),
    )
    : {};
  return {
    items: items.flatMap((folder) => {
      const id = String(folder?.id || '').trim();
      const name = String(folder?.name || '').trim();
      if (!id || !name) return [];
      return [{
        ...folder,
        id,
        name,
        unread_count: Number(folder.unread_count || 0),
        conversation_ids: Array.isArray(folder.conversation_ids)
          ? folder.conversation_ids.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
      }];
    }),
    conversation_ids_by_folder: data.conversation_ids_by_folder || {},
    folder_unread_counts: folderUnreadCounts,
  };
}

export async function createChatFolder(name: string): Promise<ChatFolderSummary> {
  const { data } = await apiClient.post<{ item?: ChatFolderSummary } | ChatFolderSummary>('/chat/folders', { name });
  const item = (data as { item?: ChatFolderSummary }).item || data;
  const id = String((item as ChatFolderSummary)?.id || '').trim();
  const folderName = String((item as ChatFolderSummary)?.name || name).trim();
  if (!id) throw new Error('Сервер вернул некорректную папку');
  return { id, name: folderName, conversation_ids: [] };
}

export async function updateChatFolder(
  folderId: string,
  payload: { name?: string; sort_order?: number },
): Promise<ChatFolderSummary> {
  const { data } = await apiClient.patch<{ item?: ChatFolderSummary } | ChatFolderSummary>(
    `/chat/folders/${folderId}`,
    payload,
  );
  const item = (data as { item?: ChatFolderSummary }).item || data;
  return {
    id: String((item as ChatFolderSummary)?.id || folderId),
    name: String((item as ChatFolderSummary)?.name || payload.name || 'Папка'),
    conversation_ids: Array.isArray((item as ChatFolderSummary)?.conversation_ids)
      ? (item as ChatFolderSummary).conversation_ids
      : [],
  };
}

export async function deleteChatFolder(folderId: string): Promise<void> {
  await apiClient.delete(`/chat/folders/${folderId}`);
}

export async function addFolderConversation(folderId: string, conversationId: string): Promise<void> {
  await apiClient.post(`/chat/folders/${folderId}/conversations/${conversationId}`);
}

export async function removeFolderConversation(folderId: string, conversationId: string): Promise<void> {
  await apiClient.delete(`/chat/folders/${folderId}/conversations/${conversationId}`);
}

export async function getConversationAttachments(
  conversationId: string,
  options: { kind?: 'image' | 'video' | 'file' | 'audio'; limit?: number; beforeAttachmentId?: string } = {},
): Promise<ChatAttachmentPage> {
  const { data } = await apiClient.get<{
    items?: ChatConversationAttachment[];
    has_more?: boolean;
    next_before_attachment_id?: string | null;
  }>(
    `/chat/conversations/${conversationId}/attachments`,
    {
      params: {
        kind: options.kind || 'image',
        limit: options.limit ?? 24,
        before_attachment_id: options.beforeAttachmentId || undefined,
      },
    },
  );
  const items = (Array.isArray(data.items) ? data.items : []).flatMap((item) => {
    const id = String(item?.id || '').trim();
    const messageId = String(item?.message_id || '').trim();
    if (!id || !messageId) return [];
    return [{ ...item, id, message_id: messageId }];
  });
  return {
    items,
    has_more: Boolean(data.has_more),
    next_before_attachment_id: String(data.next_before_attachment_id || '').trim() || null,
  };
}

function normalizeAiBot(value: unknown): ChatAiBot | null {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const id = String(item.id || '').trim();
  if (!id) return null;
  const title = String(item.title || item.name || '').trim();
  const conversationIds = Array.isArray(item.conversation_ids)
    ? item.conversation_ids.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  return {
    id,
    name: title || id,
    title: title || undefined,
    slug: String(item.slug || '').trim() || undefined,
    description: String(item.description || '').trim() || null,
    surface: String(item.surface || '').trim() || undefined,
    conversation_id: String(item.conversation_id || '').trim() || null,
    conversation_ids: conversationIds,
    use_personal_memory: typeof item.use_personal_memory === 'boolean' ? item.use_personal_memory : undefined,
    allow_file_input: typeof item.allow_file_input === 'boolean' ? item.allow_file_input : undefined,
  };
}

export async function getAiBots(): Promise<ChatAiBot[]> {
  const { data } = await apiClient.get<{ items?: unknown[] } | unknown[]>('/chat/ai/bots');
  const items = Array.isArray(data) ? data : data.items || [];
  return items.map(normalizeAiBot).filter((item): item is ChatAiBot => Boolean(item));
}

export async function openAiBot(botId: string): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<unknown>(`/chat/ai/bots/${encodeURIComponent(botId)}/open`, {});
  return requiredConversation(data);
}

export async function createAiConversation(): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<unknown>('/chat/ai/conversations');
  return requiredConversation(data);
}

export async function renameAiConversation(
  conversationId: string,
  title: string,
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.patch<unknown>(
    `/chat/ai/conversations/${encodeURIComponent(conversationId)}`,
    { title },
  );
  return requiredConversation(data);
}

export async function deleteAiConversation(conversationId: string): Promise<void> {
  await apiClient.delete(`/chat/ai/conversations/${encodeURIComponent(conversationId)}`);
}

export async function resetAiConversationContext(conversationId: string): Promise<void> {
  await apiClient.post(
    `/chat/ai/conversations/${encodeURIComponent(conversationId)}/reset-context`,
  );
}

export async function getAiSandboxConversation(conversationId: string): Promise<unknown> {
  const { data } = await apiClient.get(
    `/chat/ai/sandbox/conversations/${encodeURIComponent(conversationId)}`,
  );
  return data;
}

export async function getAiConversationAccess(conversationId: string): Promise<{ can_use: boolean }> {
  const { data } = await apiClient.get(`/chat/ai/conversations/${encodeURIComponent(conversationId)}/access`);
  return { can_use: data?.can_use === true };
}

export async function respondAiSandboxPermission(
  permissionId: string,
  decision: 'allow' | 'reject',
  scope: 'once' | 'session' = 'once',
): Promise<void> {
  await apiClient.post(
    `/chat/ai/sandbox/permissions/${encodeURIComponent(permissionId)}/respond`,
    { decision, scope },
  );
}

export async function attachAiSandboxArchive(conversationId: string): Promise<void> {
  await apiClient.post(
    `/chat/ai/sandbox/conversations/${encodeURIComponent(conversationId)}/archive/attach`,
  );
}

export async function attachAiSandboxFile(fileId: string): Promise<void> {
  await apiClient.post(`/chat/ai/sandbox/files/${encodeURIComponent(fileId)}/attach`);
}

export type ChatUnreadSummary = {
  messages_unread_total: number;
  conversations_unread: number;
};

let unreadSummaryRequest: Promise<ChatUnreadSummary> | null = null;

subscribeAccessTokenChanges(() => {
  unreadSummaryRequest = null;
});

export function getUnreadSummary(): Promise<ChatUnreadSummary> {
  if (!unreadSummaryRequest) {
    const request = apiClient.get<{
      messages_unread_total?: number;
      unread_total?: number;
      conversations_unread?: number;
    }>('/chat/unread-summary').then(({ data }) => ({
      messages_unread_total: Math.max(0, Number(data?.messages_unread_total || data?.unread_total || 0)),
      conversations_unread: Math.max(0, Number(data?.conversations_unread || 0)),
    }));
    const sharedRequest = request.finally(() => {
      if (unreadSummaryRequest === sharedRequest) unreadSummaryRequest = null;
    });
    unreadSummaryRequest = sharedRequest;
  }
  return unreadSummaryRequest;
}
