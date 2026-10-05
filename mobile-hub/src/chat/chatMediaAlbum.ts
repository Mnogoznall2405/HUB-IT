import type { ChatAttachment, ChatMessage } from '../api/types';
import { isImageChatAttachment, isVideoChatAttachment } from './chatMedia';

export type ChatMediaAlbumEntry = {
  message: ChatMessage;
  attachment: ChatAttachment;
};

export type ChatMediaAlbum = {
  /** Message that renders the album grid (the album's own message). */
  headId: string;
  entries: ChatMediaAlbumEntry[];
  /** Caption of the message (Telegram shows it under the grid). */
  caption: string;
};

/** An album is the set of photos/videos sent together in ONE message (Telegram's
 * grouped media). Separate messages are never merged — each keeps its own
 * reply/delete/reactions even when sent seconds apart. Failed/cancelled sends
 * stay standalone so their retry/discard actions remain on the bubble. */
function isAlbumEligibleMessage(message: ChatMessage): boolean {
  if (message.is_deleted || (message.local_status && message.local_status !== 'sending')) return false;
  // Real attachment messages (pending and server-delivered) carry kind 'file'.
  if (!['text', 'file'].includes(String(message.kind || 'text'))) return false;
  if (message.reply_preview || message.forward_preview) return false;
  const attachments = message.attachments || [];
  if (attachments.length < 2) return false;
  return attachments.every(
    (attachment) => isImageChatAttachment(attachment) || isVideoChatAttachment(attachment),
  );
}

export function buildChatMediaAlbumMap(messages: ChatMessage[]): Map<string, ChatMediaAlbum> {
  const map = new Map<string, ChatMediaAlbum>();
  messages.forEach((message) => {
    if (!isAlbumEligibleMessage(message)) return;
    map.set(message.id, {
      headId: message.id,
      entries: (message.attachments || []).map((attachment) => ({ message, attachment })),
      caption: String(message.body_text || message.body || '').trim(),
    });
  });
  return map;
}
