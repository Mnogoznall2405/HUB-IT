import type { ChatAttachment, ChatMessage, ChatUserSummary } from '../api/types';
import type { NativePickedFile } from '../files/nativeFilePicker';

export type PendingAttachmentMediaKind = 'image' | 'video' | 'file' | 'audio';

function resolvePendingAttachmentKind(
  file: NativePickedFile,
  explicitKind: PendingAttachmentMediaKind | undefined,
  index: number,
): PendingAttachmentMediaKind {
  if (explicitKind && index === 0) return explicitKind;
  if (file.source === 'document') return 'file';
  const mimeType = String(file.mimeType || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

export function pendingAttachmentId(clientMessageId: string, index: number): string {
  return `pending-attachment:${clientMessageId}:${index}`;
}

export function buildPendingChatAttachments(
  files: NativePickedFile[],
  clientMessageId: string,
  mediaKind?: PendingAttachmentMediaKind,
): ChatAttachment[] {
  return files.map((file, index) => {
    const kind = resolvePendingAttachmentKind(file, mediaKind, index);
    return {
      id: pendingAttachmentId(clientMessageId, index),
      kind,
      media_kind: kind,
      file_name: file.name,
      mime_type: file.mimeType,
      file_size: file.size,
      local_uri: file.uri,
    };
  });
}

export function buildPendingAttachmentMessage({
  conversationId,
  clientMessageId,
  files,
  mediaKind,
  body,
  bodyFormat,
  replyPreview,
  sender,
}: {
  conversationId: string;
  clientMessageId: string;
  files: NativePickedFile[];
  mediaKind?: PendingAttachmentMediaKind;
  body?: string;
  bodyFormat?: 'plain' | 'markdown';
  replyPreview?: ChatMessage['reply_preview'];
  sender?: ChatUserSummary | null;
}): ChatMessage {
  const normalizedBody = String(body || '').trim();
  return {
    id: `pending:${clientMessageId}`,
    conversation_id: conversationId,
    sender_user_id: Number(sender?.id || 0),
    sender: sender || null,
    client_message_id: clientMessageId,
    kind: 'file',
    body: normalizedBody,
    body_text: normalizedBody,
    body_format: bodyFormat || 'plain',
    created_at: new Date().toISOString(),
    is_own: true,
    local_status: 'sending',
    attachments: buildPendingChatAttachments(files, clientMessageId, mediaKind),
    reactions: [],
    reply_preview: replyPreview || null,
  };
}

export function isAttachmentTransferAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const candidate = error as { name?: string; code?: string; message?: string } | null;
  const name = String(candidate?.name || '').toLowerCase();
  const code = String(candidate?.code || '').toLowerCase();
  const message = String(candidate?.message || '').toLowerCase();
  return name === 'aborterror'
    || code === 'err_canceled'
    || code === 'aborted'
    || message.includes('aborted')
    || message.includes('canceled')
    || message.includes('cancelled');
}
