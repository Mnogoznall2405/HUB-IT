import type { ChatAttachment, ChatMessage } from '../api/types';
import { isStickerChatAttachment } from './chatStickers';
import { isAudioChatAttachment } from './chatVoice';

export type ChatBubbleGroupPosition = 'single' | 'first' | 'middle' | 'last';

/**
 * Where the time and delivery ticks are placed inside a bubble.
 * `inline` keeps them on the last text line, `overlay` floats them above media.
 */
export type ChatBubbleMetaMode = 'inline' | 'overlay' | 'row';

export const CHAT_PHOTO_DEFAULT_ASPECT = 1.35;
export const CHAT_PHOTO_MIN_ASPECT = 0.62;
export const CHAT_PHOTO_MAX_ASPECT = 1.9;
export const CHAT_STICKER_SIZE = 148;
export const CHAT_SENDER_AVATAR_SIZE = 28;

export function isPhotoChatAttachment(attachment?: ChatAttachment | null): boolean {
  if (!attachment) return false;
  if (isStickerChatAttachment(attachment)) return false;
  const kind = String(attachment.media_kind || attachment.kind || '').trim().toLowerCase();
  if (kind === 'file' || kind === 'video' || kind === 'audio') return false;
  if (kind === 'image') return true;
  return String(attachment.mime_type || '').startsWith('image/');
}

export function isStickerOnlyMessage(message: ChatMessage): boolean {
  if (message.is_deleted) return false;
  const attachments = message.attachments || [];
  if (attachments.length !== 1 || !isStickerChatAttachment(attachments[0])) return false;
  const body = String(message.body_text || '').trim();
  if (!body) return true;
  const caption = String(attachments[0].file_name || '').trim();
  return Boolean(caption) && body === caption && !caption.includes('.') && !caption.toLowerCase().startsWith('sticker-');
}

export function resolveChatBubbleMetaMode(input: {
  hasText: boolean;
  hasPhoto: boolean;
  isStickerOnly: boolean;
  /** Link preview, AI action card or retry line rendered after the text. */
  hasTrailingBlock: boolean;
}): ChatBubbleMetaMode {
  if (input.hasTrailingBlock) return 'row';
  if (input.isStickerOnly) return 'overlay';
  if (input.hasText) return 'inline';
  if (input.hasPhoto) return 'overlay';
  return 'row';
}

/**
 * Mirrors the visible meta string, including ticks and the edited marker,
 * so the reserved gap on the last text line matches what is drawn over it.
 */
export function buildChatMetaPlainText(input: {
  timeLabel: string;
  sending: boolean;
  edited: boolean;
  showTicks: boolean;
  read: boolean;
}): string {
  return [
    input.sending ? 'Отправляется · ' : '',
    input.timeLabel,
    input.edited ? ' · изм.' : '',
    input.showTicks ? (input.read ? ' ✓✓' : ' ✓') : '',
  ].join('');
}

/**
 * The floating meta is reserved with an inline spacer rather than a nested
 * text node, so the width is estimated instead of measured. Rounded up on
 * purpose: an overshoot only widens the gap, an undershoot covers a word.
 */
export function estimateChatMetaWidth(metaPlainText: string): number {
  const length = String(metaPlainText || '').length;
  if (!length) return 0;
  return Math.round(length * 5.9) + 8;
}

/**
 * Bubbles drop their padding only when media fills the whole bubble,
 * otherwise the photo would collide with the sender name or a quote.
 */
export function shouldBleedBubbleMedia(input: {
  hasText: boolean;
  hasPhoto: boolean;
  hasSenderName: boolean;
  hasQuote: boolean;
  hasForwardNote: boolean;
  hasTrailingBlock: boolean;
}): boolean {
  if (!input.hasPhoto) return false;
  return !input.hasText
    && !input.hasSenderName
    && !input.hasQuote
    && !input.hasForwardNote
    && !input.hasTrailingBlock;
}

export function resolveChatPhotoAspect(width?: number | null, height?: number | null): number {
  const safeWidth = Number(width || 0);
  const safeHeight = Number(height || 0);
  if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight)) return CHAT_PHOTO_DEFAULT_ASPECT;
  if (safeWidth <= 0 || safeHeight <= 0) return CHAT_PHOTO_DEFAULT_ASPECT;
  return Math.min(CHAT_PHOTO_MAX_ASPECT, Math.max(CHAT_PHOTO_MIN_ASPECT, safeWidth / safeHeight));
}

export function resolveChatPhotoWidth(windowWidth: number): number {
  const safeWidth = Number(windowWidth || 0);
  if (!Number.isFinite(safeWidth) || safeWidth <= 0) return 240;
  return Math.max(180, Math.min(272, Math.round(safeWidth * 0.64)));
}

export function shouldShowSenderAvatar(input: {
  isOwn: boolean;
  showSenderAvatars: boolean;
  groupPosition: ChatBubbleGroupPosition;
}): boolean {
  if (input.isOwn || !input.showSenderAvatars) return false;
  return input.groupPosition === 'single' || input.groupPosition === 'last';
}

/** Avatars are only meaningful where more than two people can post. */
export function shouldShowSenderAvatarsForKind(kind?: string | null): boolean {
  const value = String(kind || '').trim();
  return value === 'group' || value === 'task';
}

export function hasVoiceChatAttachment(message: ChatMessage): boolean {
  if (message.is_deleted) return false;
  return (message.attachments || []).some((attachment) => isAudioChatAttachment(attachment));
}
