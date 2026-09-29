import type { ChatAttachment, ChatMessage } from '../api/types';
import { isImageChatAttachment, isVideoChatAttachment } from './chatMedia';

export type ChatMediaAlbumEntry = {
  message: ChatMessage;
  attachment: ChatAttachment;
};

export type ChatMediaAlbum = {
  /** Chronologically first message id — the row that renders the album grid. */
  headId: string;
  entries: ChatMediaAlbumEntry[];
  /** Caption of the first captioned member (Telegram shows it under the grid). */
  caption: string;
};

const ALBUM_GAP_MS = 2 * 60_000;

/** DEV-MEDIA-3: captions, videos and in-flight sends are album-eligible —
 * Telegram merges a captioned photo, a mixed photo+video set and queued
 * uploads into one album bubble. Failed/cancelled sends stay standalone so
 * their retry/discard actions remain on the single-message bubble. */
function isAlbumEligibleMessage(message: ChatMessage): boolean {
  if (message.is_deleted || (message.local_status && message.local_status !== 'sending')) return false;
  if (String(message.kind || 'text') !== 'text') return false;
  if (message.reply_preview || (message as { forwarded_from?: unknown }).forwarded_from) return false;
  const attachments = message.attachments || [];
  if (!attachments.length) return false;
  return attachments.every(
    (attachment) => isImageChatAttachment(attachment) || isVideoChatAttachment(attachment),
  );
}

/** DEV-MEDIA-1: Telegram-style album grouping — consecutive photo-only
 * messages from one sender (within a short window) render as one grid bubble.
 * `messages` come newest-first (inverted list). */
export function buildChatMediaAlbumMap(messages: ChatMessage[]): Map<string, ChatMediaAlbum> {
  const map = new Map<string, ChatMediaAlbum>();
  let pending: ChatMediaAlbumEntry[] = [];

  const flush = () => {
    if (pending.length < 2) {
      pending = [];
      return;
    }
    // `pending` is collected oldest→newest (inverted list walked backwards),
    // so it is already chronological; the head is the first (oldest) message.
    const chronological = pending;
    const captionEntry = chronological.find(
      (entry) => String(entry.message.body_text || entry.message.body || '').trim(),
    );
    const album: ChatMediaAlbum = {
      headId: chronological[0].message.id,
      entries: chronological,
      caption: String(captionEntry?.message.body_text || captionEntry?.message.body || '').trim(),
    };
    chronological.forEach((entry) => map.set(entry.message.id, album));
    pending = [];
  };

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const eligible = isAlbumEligibleMessage(message);
    const previous = pending[pending.length - 1]?.message;
    const sameSender = Boolean(previous)
      && Number(previous.sender_user_id || 0) === Number(message.sender_user_id || 0);
    const closeInTime = !previous || Math.abs(
      Date.parse(String(previous.created_at || '')) - Date.parse(String(message.created_at || '')),
    ) <= ALBUM_GAP_MS;
    const pushMessage = () => {
      (message.attachments || []).forEach((attachment) => pending.push({ message, attachment }));
    };
    if (eligible && (!pending.length || (sameSender && closeInTime))) {
      pushMessage();
      continue;
    }
    flush();
    if (eligible) pushMessage();
  }
  flush();
  return map;
}
