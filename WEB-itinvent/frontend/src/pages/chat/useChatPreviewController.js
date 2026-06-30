import { useCallback, useState } from 'react';

import chatAttachmentsAPI from '../../api/chatAttachments';
import {
  buildAttachmentUrl,
  isMediaAttachment,
  isVideoAttachment,
  normalizeChatAttachmentUrl,
  pickBlobAttachmentUrl,
} from '../../components/chat/chatHelpers';
import {
  buildChatDocumentPreviewState,
  isChatDocumentPreviewableAttachment,
  mapChatAttachmentForPreview,
} from '../../components/chat/chatAttachmentPreview';
import {
  buildAttachmentBlobPayload,
  createEmptyAttachmentPreview,
  downloadBlobFile,
} from '../../components/mail/mailMessageFileActions';
import { isSendingOptimisticThreadMessage } from './chatThreadMessages';

export function revokeDocumentPreviewObjectUrl(current) {
  if (current?.objectUrl && typeof window.URL?.revokeObjectURL === 'function') {
    try {
      window.URL.revokeObjectURL(current.objectUrl);
    } catch {
      // Ignore revoke failures on close.
    }
  }
}

export default function useChatPreviewController({
  activeConversationIdRef,
  loadChatDialogsModule,
  messagesRef,
  notifyApiError,
}) {
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);

  const closeAttachmentPreview = useCallback(() => {
    setAttachmentPreview(null);
  }, []);

  const closeDocumentPreview = useCallback(() => {
    setDocumentPreview((current) => {
      revokeDocumentPreviewObjectUrl(current);
      return null;
    });
  }, []);

  const openDocumentPreview = useCallback(async (messageId, attachment) => {
    void loadChatDialogsModule();
    const normalizedMessageId = String(messageId || '').trim();
    const attachmentId = String(attachment?.id || '').trim();
    if (!normalizedMessageId || !attachmentId) return;

    const mapped = mapChatAttachmentForPreview(attachment);
    setDocumentPreview({
      ...createEmptyAttachmentPreview(),
      open: true,
      loading: true,
      filename: mapped.name,
      contentType: mapped.content_type,
    });

    try {
      const previewState = await buildChatDocumentPreviewState({
        chatAttachmentsAPI,
        messageId: normalizedMessageId,
        attachmentId,
        attachment,
      });
      setDocumentPreview(previewState);
    } catch (error) {
      setDocumentPreview({
        ...createEmptyAttachmentPreview(),
        open: true,
        loading: false,
        error: String(error?.message || 'Не удалось открыть предпросмотр документа.'),
        filename: mapped.name,
        contentType: mapped.content_type,
      });
    }
  }, [loadChatDialogsModule]);

  const handleDownloadDocumentPreview = useCallback(async () => {
    const ctx = documentPreview?.downloadContext;
    if (!ctx?.messageId || !ctx?.attachmentId) return;
    try {
      const response = await chatAttachmentsAPI.downloadAttachment(ctx.messageId, ctx.attachmentId);
      const { blob, filename } = buildAttachmentBlobPayload({
        response,
        attachment: mapChatAttachmentForPreview(ctx.attachment),
      });
      downloadBlobFile(blob, filename, { preferOpenFallback: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось скачать файл.');
    }
  }, [documentPreview, notifyApiError]);

  const handleDownloadDocumentPreviewPdf = useCallback(async () => {
    const ctx = documentPreview?.downloadContext;
    if (!ctx?.messageId || !ctx?.attachmentId) return;
    try {
      const response = await chatAttachmentsAPI.downloadAttachmentPreviewPdf(ctx.messageId, ctx.attachmentId);
      const { blob, filename } = buildAttachmentBlobPayload({
        response,
        attachment: {
          name: documentPreview?.pdfFilename || `${documentPreview?.filename || 'preview'}.pdf`,
          content_type: 'application/pdf',
        },
      });
      downloadBlobFile(blob, filename, { preferOpenFallback: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось скачать PDF-предпросмотр.');
    }
  }, [documentPreview, notifyApiError]);

  const openAttachmentPreview = useCallback((messageId, attachment) => {
    void loadChatDialogsModule();
    const normalizedMessageId = String(messageId || '').trim();
    const attachmentId = String(attachment?.id || '').trim();
    if (!normalizedMessageId || !attachmentId) return;
    const sourceMessage = messagesRef.current.find((item) => String(item?.id || '').trim() === normalizedMessageId);
    const senderName = String(
      sourceMessage?.sender?.full_name
      || sourceMessage?.sender?.username
      || '',
    ).trim();
    const variantUrls = attachment?.variant_urls || {};
    const inlineOriginalUrl = buildAttachmentUrl(normalizedMessageId, attachmentId, { inline: true });
    const originalUrl = normalizeChatAttachmentUrl(attachment?.original_url || attachment?.originalUrl)
      || inlineOriginalUrl
      || buildAttachmentUrl(normalizedMessageId, attachmentId);
    const previewUrl = normalizeChatAttachmentUrl(
      attachment?.preview_url
      || attachment?.previewUrl
      || variantUrls.preview
      || variantUrls.thumb,
    ) || originalUrl;
    setAttachmentPreview({
      messageId: normalizedMessageId,
      attachment: {
        ...attachment,
        id: attachmentId,
        file_name: String(attachment?.file_name || '').trim() || 'Изображение',
        file_size: Number(attachment?.file_size || 0),
      },
      fileUrl: originalUrl,
      previewUrl,
      originalUrl,
      posterUrl: normalizeChatAttachmentUrl(attachment?.poster_url || attachment?.posterUrl || variantUrls.poster),
      senderName,
      createdAt: String(sourceMessage?.created_at || '').trim(),
      activeIndex: 0,
      totalCount: 1,
    });
  }, [loadChatDialogsModule, messagesRef]);

  const openMediaViewer = useCallback((messageId, attachment) => {
    void loadChatDialogsModule();
    const normalizedMessageId = String(messageId || '').trim();
    const attachmentId = String(attachment?.id || '').trim();
    if (!normalizedMessageId || !attachmentId) return;

    const normalizePreviewAttachment = (item) => {
      const normalizedItemId = String(item?.id || '').trim();
      if (!normalizedItemId) return null;
      const variantUrls = item?.variant_urls || {};
      const localBlobUrl = pickBlobAttachmentUrl(
        item?.preview_url,
        item?.previewUrl,
        item?.original_url,
        item?.originalUrl,
        item?.open_url,
        item?.openUrl,
        variantUrls.preview,
        variantUrls.thumb,
      );
      const inlineOriginalUrl = buildAttachmentUrl(normalizedMessageId, normalizedItemId, { inline: true });
      const originalUrl = localBlobUrl
        || normalizeChatAttachmentUrl(item?.original_url || item?.originalUrl)
        || inlineOriginalUrl
        || buildAttachmentUrl(normalizedMessageId, normalizedItemId);
      const previewUrl = localBlobUrl
        || normalizeChatAttachmentUrl(
          item?.preview_url
          || item?.previewUrl
          || variantUrls.preview
          || variantUrls.thumb,
        )
        || originalUrl;
      return {
        ...item,
        id: normalizedItemId,
        file_name: String(item?.file_name || '').trim() || 'Вложение',
        file_size: Number(item?.file_size || 0),
        mime_type: String(item?.mime_type || '').trim(),
        fileUrl: originalUrl,
        previewUrl,
        originalUrl,
        posterUrl: normalizeChatAttachmentUrl(item?.poster_url || item?.posterUrl || variantUrls.poster),
      };
    };

    const normalizedAttachment = normalizePreviewAttachment(attachment);
    if (!normalizedAttachment) return;
    if (!isMediaAttachment(normalizedAttachment)) {
      if (isChatDocumentPreviewableAttachment(normalizedAttachment)) {
        void openDocumentPreview(normalizedMessageId, attachment);
        return;
      }
      const openUrl = normalizeChatAttachmentUrl(
        normalizedAttachment?.open_url
        || normalizedAttachment?.openUrl
        || normalizedAttachment?.originalUrl,
      )
        || buildAttachmentUrl(normalizedMessageId, attachmentId, { inline: true });
      window.open(openUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const sourceMessage = messagesRef.current.find((item) => String(item?.id || '').trim() === normalizedMessageId);
    const senderName = String(
      sourceMessage?.sender?.full_name
      || sourceMessage?.sender?.username
      || '',
    ).trim();
    const mediaItems = (Array.isArray(sourceMessage?.attachments) ? sourceMessage.attachments : [])
      .map(normalizePreviewAttachment)
      .filter(Boolean)
      .filter(isMediaAttachment);
    const previewItems = mediaItems.length > 0 ? mediaItems : [normalizedAttachment];
    const activeIndex = Math.max(0, previewItems.findIndex((item) => item.id === attachmentId));
    const activeAttachment = previewItems[activeIndex] || normalizedAttachment;

    const isProcessing = isSendingOptimisticThreadMessage(sourceMessage, activeConversationIdRef.current)
      || String(sourceMessage?.delivery_status || '').trim() === 'sending';

    setAttachmentPreview({
      messageId: normalizedMessageId,
      attachment: activeAttachment,
      fileUrl: activeAttachment.originalUrl || activeAttachment.fileUrl,
      previewUrl: activeAttachment.previewUrl || activeAttachment.fileUrl,
      originalUrl: activeAttachment.originalUrl || activeAttachment.fileUrl,
      posterUrl: activeAttachment.posterUrl || '',
      items: previewItems,
      activeIndex,
      totalCount: previewItems.length,
      senderName,
      createdAt: String(sourceMessage?.created_at || '').trim(),
      kind: isVideoAttachment(activeAttachment) ? 'video' : 'image',
      startedFromGallery: previewItems.length > 1,
      isProcessing,
    });
  }, [activeConversationIdRef, loadChatDialogsModule, messagesRef, openDocumentPreview]);

  return {
    attachmentPreview,
    documentPreview,
    openAttachmentPreview,
    openMediaViewer,
    closeAttachmentPreview,
    closeDocumentPreview,
    openDocumentPreview,
    handleDownloadDocumentPreview,
    handleDownloadDocumentPreviewPdf,
  };
}
