import type { MailAttachment, MailMessageDetail } from '../api/mailApi';
import { getNativeMailAttachmentImageSource, getNativeMailAttachmentKind } from './nativeMailAttachmentVisual';
import { prepareNativeMailHtml } from './nativeMailHtml';

export type NativeMailImageGalleryItem = {
  key: string;
  name: string;
  uri: string;
  messageId: string;
  mailboxId: string;
  attachment: MailAttachment;
};

export function nativeMailAttachmentReference(attachment: MailAttachment, fallback = 'file'): string {
  return String(attachment.download_token || attachment.id || fallback).trim();
}

export function getVisibleNativeMailAttachments(message: MailMessageDetail): MailAttachment[] {
  const htmlPreview = prepareNativeMailHtml(message.body_html, message.attachments || []);
  return (message.attachments || []).filter((attachment) => {
    const ref = nativeMailAttachmentReference(attachment, '');
    return (!ref || !htmlPreview.usedInlineAttachmentRefs.has(ref)) && (!attachment.is_inline || attachment.downloadable !== false);
  });
}

export function buildNativeMailImageGallery(messages: MailMessageDetail[]): NativeMailImageGalleryItem[] {
  return messages.flatMap((message) => getVisibleNativeMailAttachments(message)
    .map((attachment, index) => ({ attachment, index }))
    .filter(({ attachment }) => getNativeMailAttachmentKind(attachment) === 'image' && attachment.downloadable !== false)
    .map(({ attachment, index }) => ({
      key: `${message.id}:${nativeMailAttachmentReference(attachment, String(index))}`,
      messageId: message.id,
      mailboxId: String(message.mailbox_id || ''),
      name: String(attachment.name || 'Изображение'),
      uri: getNativeMailAttachmentImageSource(attachment),
      attachment,
    })));
}

export function withNativeMailAttachmentPreview(
  message: MailMessageDetail,
  attachment: MailAttachment,
  uri: string,
): MailMessageDetail {
  const reference = nativeMailAttachmentReference(attachment, '');
  return {
    ...message,
    attachments: (message.attachments || []).map((item) => (
      nativeMailAttachmentReference(item, '') === reference ? { ...item, native_preview_uri: uri } : item
    )),
  };
}
