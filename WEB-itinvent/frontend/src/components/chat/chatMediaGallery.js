import { buildAttachmentUrl, isMediaAttachment, normalizeChatAttachmentUrl, pickBlobAttachmentUrl } from './chatHelpers';

export const mediaGalleryKey = (item) => `${item?.messageId || item?.message_id || ''}:${item?.id || ''}`;

export function toGalleryItem(attachment, message = {}) {
  const id = String(attachment?.id || '').trim();
  const messageId = String(message?.id || attachment?.message_id || '').trim();
  if (!id || !messageId || !isMediaAttachment(attachment)) return null;
  const variants = attachment.variant_urls || {};
  const local = pickBlobAttachmentUrl(attachment.preview_url, attachment.previewUrl, attachment.original_url, attachment.originalUrl, variants.preview, variants.thumb);
  const originalUrl = local || normalizeChatAttachmentUrl(attachment.original_url || attachment.originalUrl)
    || buildAttachmentUrl(messageId, id, { inline: true });
  return {
    ...attachment, id, messageId,
    originalUrl, fileUrl: originalUrl,
    previewUrl: local || normalizeChatAttachmentUrl(attachment.preview_url || attachment.previewUrl || variants.preview || variants.thumb) || originalUrl,
    posterUrl: normalizeChatAttachmentUrl(attachment.poster_url || attachment.posterUrl || variants.poster),
    senderName: message.sender?.full_name || message.sender?.username || attachment.sender_name || '',
    createdAt: message.created_at || attachment.created_at || '',
    isProcessing: message.delivery_status === 'sending',
  };
}

export function mergeGalleryItems(...lists) {
  const unique = new Map();
  lists.flat().filter(Boolean).forEach((item) => {
    const key = mediaGalleryKey(item);
    unique.set(key, { ...item, ...unique.get(key) });
  });
  return [...unique.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || mediaGalleryKey(b).localeCompare(mediaGalleryKey(a)));
}
