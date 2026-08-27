import type { ChatAttachment, ChatConversationAttachment, ChatMessage } from '../api/types';
import { isStickerChatAttachment } from './chatStickers';
import { isAudioChatAttachment } from './chatVoice';

export type ChatMediaItem = {
  message: ChatMessage;
  attachment: ChatAttachment;
};

export function isImageChatAttachment(attachment?: ChatAttachment | null): boolean {
  if (!attachment) return false;
  const kind = String(attachment.media_kind || attachment.kind || '').trim().toLowerCase();
  if (kind === 'file' || kind === 'video' || kind === 'audio' || kind === 'sticker') return false;
  if (kind === 'image') return true;
  return String(attachment.mime_type || '').startsWith('image/');
}

export function isVideoChatAttachment(attachment?: ChatAttachment | null): boolean {
  if (!attachment) return false;
  const kind = String(attachment.media_kind || attachment.kind || '').trim().toLowerCase();
  if (kind === 'file' || kind === 'image' || kind === 'audio' || kind === 'sticker') return false;
  if (kind === 'video') return true;
  return String(attachment.mime_type || '').startsWith('video/');
}

export function isMediaChatAttachment(attachment?: ChatAttachment | null): boolean {
  return isImageChatAttachment(attachment) || isVideoChatAttachment(attachment);
}

export function pickChatAttachmentPreviewUrl(attachment?: ChatAttachment | null): string | null {
  if (!attachment) return null;
  return String(
    attachment.variant_urls?.preview
    || attachment.variant_urls?.thumbnail
    || attachment.preview_url
    || attachment.original_url
    || attachment.url
    || '',
  ).trim() || null;
}

export function pickChatAttachmentPlaybackUrl(attachment?: ChatAttachment | null): string | null {
  if (!attachment) return null;
  return String(
    attachment.download_url
    || attachment.original_url
    || attachment.url
    || attachment.variant_urls?.original
    || pickChatAttachmentPreviewUrl(attachment)
    || '',
  ).trim() || null;
}

export function collectThreadMedia(messages: ChatMessage[]): ChatMediaItem[] {
  const items: ChatMediaItem[] = [];
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    if (message.is_deleted) return;
    (message.attachments || []).forEach((attachment) => {
      if (isAudioChatAttachment(attachment) || isStickerChatAttachment(attachment)) return;
      if (isMediaChatAttachment(attachment)) items.push({ message, attachment });
    });
  });
  return items;
}

export function pickChatAttachmentOriginalUrl(attachment?: ChatAttachment | null): string | null {
  if (!attachment) return null;
  return String(
    attachment.original_url
    || attachment.variant_urls?.original
    || attachment.download_url
    || attachment.url
    || '',
  ).trim() || null;
}

export function mergeChatMediaItems(...collections: ChatMediaItem[][]): ChatMediaItem[] {
  const byAttachmentId = new Map<string, { item: ChatMediaItem; order: number }>();
  let order = 0;
  collections.forEach((collection) => {
    (Array.isArray(collection) ? collection : []).forEach((item) => {
      const attachmentId = String(item?.attachment?.id || '').trim();
      if (!attachmentId) return;
      const previous = byAttachmentId.get(attachmentId);
      byAttachmentId.set(attachmentId, {
        item: previous
          ? {
            message: { ...item.message, ...previous.item.message },
            attachment: { ...item.attachment, ...previous.item.attachment },
          }
          : item,
        order: previous?.order ?? order++,
      });
    });
  });
  return [...byAttachmentId.values()]
    .sort((left, right) => {
      const leftTime = Date.parse(String(left.item.message.created_at || '')) || 0;
      const rightTime = Date.parse(String(right.item.message.created_at || '')) || 0;
      return rightTime - leftTime || left.order - right.order;
    })
    .map(({ item }) => item);
}

export function findThreadMediaIndex(
  items: ChatMediaItem[],
  messageId: string,
  attachmentId: string,
): number {
  return items.findIndex((item) => (
    item.message.id === messageId && item.attachment.id === attachmentId
  ));
}

export function stepThreadMediaIndex(index: number, direction: 'next' | 'prev', length: number): number | null {
  if (length <= 0) return null;
  const nextIndex = direction === 'next' ? index + 1 : index - 1;
  if (nextIndex < 0 || nextIndex >= length) return null;
  return nextIndex;
}

export function shouldPageMediaViewer(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < 80 || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}

export function clampMediaZoom(scale: number): number {
  return Math.max(1, Math.min(4, scale));
}

export type MediaViewerDragAxis = 'page' | 'dismiss' | 'zoom';
export type MediaViewerReleaseAction = 'next' | 'prev' | 'dismiss' | 'settle';

export function mediaViewerDragAxis(
  dx: number,
  dy: number,
  scale: number,
): MediaViewerDragAxis | null {
  'worklet';
  if (scale > 1.01) return 'zoom';
  if (dy >= 12 && dy > Math.abs(dx) * 2) return 'dismiss';
  if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) + 4) return 'page';
  return null;
}

export function resolveMediaViewerRelease({
  dx,
  dy,
  velocityX,
  velocityY,
  scale,
  width,
  height,
  canPrev,
  canNext,
}: {
  dx: number;
  dy: number;
  velocityX: number;
  velocityY: number;
  scale: number;
  width: number;
  height: number;
  canPrev: boolean;
  canNext: boolean;
}): MediaViewerReleaseAction {
  'worklet';
  if (scale > 1.01) return 'settle';
  const dismissDistance = Math.max(80, height / 6);
  if (
    dy > 0
    && dy > Math.abs(dx) * 2
    && (dy >= dismissDistance || (velocityY >= 700 && dy >= 30))
  ) {
    return 'dismiss';
  }
  const horizontal = Math.abs(dx) > Math.abs(dy) + 4;
  if (!horizontal) return 'settle';
  const shouldPage = Math.abs(dx) >= width / 3 || Math.abs(velocityX) >= 650;
  if (!shouldPage) return 'settle';
  if (dx < 0 || velocityX < -650) return canNext ? 'next' : 'settle';
  if (dx > 0 || velocityX > 650) return canPrev ? 'prev' : 'settle';
  return 'settle';
}

export function getMediaViewerPanBounds({
  viewportWidth,
  viewportHeight,
  mediaWidth,
  mediaHeight,
  scale,
}: {
  viewportWidth: number;
  viewportHeight: number;
  mediaWidth: number;
  mediaHeight: number;
  scale: number;
}): { x: number; y: number } {
  'worklet';
  if (
    viewportWidth <= 0
    || viewportHeight <= 0
    || mediaWidth <= 0
    || mediaHeight <= 0
    || scale <= 1
  ) {
    return { x: 0, y: 0 };
  }
  const fitScale = Math.min(viewportWidth / mediaWidth, viewportHeight / mediaHeight);
  const fittedWidth = mediaWidth * fitScale;
  const fittedHeight = mediaHeight * fitScale;
  return {
    x: Math.max(0, (fittedWidth * scale - viewportWidth) / 2),
    y: Math.max(0, (fittedHeight * scale - viewportHeight) / 2),
  };
}

export function clampMediaTranslation(value: number, bound: number): number {
  'worklet';
  const safeBound = Math.max(0, bound);
  return Math.max(-safeBound, Math.min(safeBound, value));
}

export function mediaItemFromConversationAttachment(
  attachment: ChatConversationAttachment,
  conversationId: string,
): ChatMediaItem {
  return {
    message: {
      id: attachment.message_id,
      conversation_id: conversationId,
      sender_user_id: 0,
      created_at: attachment.created_at || null,
      attachments: [attachment],
    },
    attachment,
  };
}
