import {
  buildAttachmentBlobPayload,
  buildAttachmentPreviewState,
  createEmptyAttachmentPreview,
  getOfficeAttachmentSourceKind,
  isOfficePreviewableAttachment,
} from '../mail/mailMessageFileActions';
import { buildOfficeAttachmentPreviewState } from '../mail/officeAttachmentPreview';

const getAttachmentPreviewExtension = (filename = '') => {
  const match = String(filename || '').trim().match(/\.([a-z0-9]+)$/i);
  return match ? String(match[1] || '').toLowerCase() : '';
};

export const mapChatAttachmentForPreview = (attachment = {}) => ({
  name: String(attachment?.file_name || attachment?.fileName || 'attachment.bin').trim() || 'attachment.bin',
  content_type: String(attachment?.mime_type || attachment?.mimeType || '').trim(),
  size: Number(attachment?.file_size ?? attachment?.fileSize ?? 0),
  id: String(attachment?.id || '').trim(),
});

export const isChatDocumentPreviewableAttachment = (attachment = {}) => {
  if (!attachment) return false;
  const mapped = mapChatAttachmentForPreview(attachment);
  if (isOfficePreviewableAttachment(mapped)) return true;

  const contentType = mapped.content_type.toLowerCase();
  const extension = getAttachmentPreviewExtension(mapped.name);
  if (contentType.includes('pdf') || extension === 'pdf') return true;
  if (
    contentType.startsWith('text/')
    || contentType.includes('json')
    || contentType.includes('xml')
    || contentType.includes('javascript')
    || contentType.includes('css')
    || contentType.includes('yaml')
    || contentType.includes('toml')
    || ['txt', 'log', 'md', 'json', 'xml', 'yaml', 'yml', 'csv'].includes(extension)
  ) {
    return true;
  }
  return false;
};

export const buildChatDocumentPreviewState = async ({
  chatAttachmentsAPI,
  messageId,
  attachmentId,
  attachment,
  createObjectUrl = (blob) => (
    typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function'
      ? window.URL.createObjectURL(blob)
      : ''
  ),
} = {}) => {
  const mapped = mapChatAttachmentForPreview(attachment);
  const filename = mapped.name;
  const contentType = mapped.content_type;
  const downloadContext = { messageId, attachmentId, attachment };

  if (isOfficePreviewableAttachment(mapped)) {
    const officeSourceKind = getOfficeAttachmentSourceKind({ filename, contentType });
    const previewState = await buildOfficeAttachmentPreviewState({
      mailAPI: chatAttachmentsAPI,
      messageId,
      attachmentRef: attachmentId,
      mailboxId: '',
      attachment: mapped,
      filename,
      contentType,
      createObjectUrl,
    });
    return {
      ...createEmptyAttachmentPreview(),
      ...previewState,
      downloadContext,
    };
  }

  const response = await chatAttachmentsAPI.downloadAttachment(messageId, attachmentId);
  const previewState = await buildAttachmentPreviewState({
    response,
    attachment: mapped,
    createObjectUrl,
  });
  return {
    ...createEmptyAttachmentPreview(),
    ...previewState,
    downloadContext,
  };
};
