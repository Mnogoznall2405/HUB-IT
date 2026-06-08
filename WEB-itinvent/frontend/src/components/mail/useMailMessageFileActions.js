import { useCallback, useMemo, useRef, useState } from 'react';
import { buildRenderedMailHtml } from './mailHtmlContent';
import {
  MAX_PREVIEW_FILE_BYTES,
  buildAttachmentBlobPayload,
  buildAttachmentContextError,
  buildAttachmentDownloadKey,
  buildAttachmentPreviewState,
  buildAttachmentRequestContext,
  buildMessageSourceDownloadPayload,
  buildPrintMailDocumentHtml,
  createEmptyAttachmentPreview,
  downloadBlobFile,
  getOfficeAttachmentSourceKind,
  isOfficePreviewableAttachment,
} from './mailMessageFileActions';
import { buildOfficeAttachmentPreviewState } from './officeAttachmentPreview';
import { formatMailPersonWithEmail } from './mailPeople';
import { getMessageBodyHtmlSource } from './useMailMessageRenderState';

const HEADERS_LOADING_ITEMS = {
  items: [{ name: '\u0421\u0442\u0430\u0442\u0443\u0441', value: '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u043e\u0432...' }],
};

export default function useMailMessageFileActions({
  mailAPI,
  selectedMessage,
  selectedRenderedHtml = '',
  viewMode,
  resolveItemMailboxId,
  getMessageDetailForListAction,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  getMailErrorDetailAsync,
  setError,
  formatFullDate,
  downloadBlobFileImpl = downloadBlobFile,
  openWindow = (...args) => window.open(...args),
} = {}) {
  const [headersOpen, setHeadersOpen] = useState(false);
  const [headersLoading, setHeadersLoading] = useState(false);
  const [messageHeaders, setMessageHeaders] = useState({ items: [] });
  const [attachmentPreview, setAttachmentPreview] = useState(createEmptyAttachmentPreview);
  const attachmentDownloadInFlightRef = useRef(new Set());

  const reportError = useCallback((value) => {
    if (typeof setError === 'function') setError(value);
  }, [setError]);

  const maybeHandleCredentials = useCallback(async (requestError, fallback) => {
    if (typeof handleMailCredentialsRequired !== 'function') return false;
    return handleMailCredentialsRequired(requestError, fallback);
  }, [handleMailCredentialsRequired]);

  const resolveMailboxId = useCallback((item) => (
    typeof resolveItemMailboxId === 'function' ? resolveItemMailboxId(item) : ''
  ), [resolveItemMailboxId]);

  const resolveAttachmentRequestContext = useCallback((messageOrId, attachment, fallbackMessage = null) => (
    buildAttachmentRequestContext({
      messageOrId,
      attachment,
      fallbackMessage,
      resolveMailboxId,
    })
  ), [resolveMailboxId]);

  const closeHeadersDialog = useCallback(() => {
    setHeadersOpen(false);
  }, []);

  const openHeadersForMessage = useCallback(async (message) => {
    if (!message?.id) return;
    setHeadersOpen(true);
    setHeadersLoading(true);
    setMessageHeaders({ items: [] });
    try {
      const data = await mailAPI.getMessageHeaders(message.id, {
        mailboxId: resolveMailboxId(message),
      });
      setMessageHeaders(data?.items ? data : { items: [] });
    } catch (requestError) {
      if (!(await maybeHandleCredentials(requestError, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0438 \u043f\u0438\u0441\u044c\u043c\u0430.'))) {
        reportError(getMailErrorDetail?.(requestError, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0438 \u043f\u0438\u0441\u044c\u043c\u0430.'));
      }
      setMessageHeaders({ items: [] });
    } finally {
      setHeadersLoading(false);
    }
  }, [getMailErrorDetail, mailAPI, maybeHandleCredentials, reportError, resolveMailboxId]);

  const downloadMessageSourceForMessage = useCallback(async (message) => {
    if (!message?.id) return;
    try {
      const response = await mailAPI.downloadMessageSource(message.id, {
        mailboxId: resolveMailboxId(message),
      });
      const { blob, filename } = buildMessageSourceDownloadPayload({ response, message });
      downloadBlobFileImpl(blob, filename, { preferOpenFallback: true });
    } catch (requestError) {
      const errorDetail = await getMailErrorDetailAsync?.(
        requestError,
        '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043a\u0430\u0447\u0430\u0442\u044c \u0438\u0441\u0445\u043e\u0434\u043d\u0438\u043a \u043f\u0438\u0441\u044c\u043c\u0430.',
      );
      if (!(await maybeHandleCredentials(requestError, errorDetail))) {
        reportError(errorDetail);
      }
    }
  }, [downloadBlobFileImpl, getMailErrorDetailAsync, mailAPI, maybeHandleCredentials, reportError, resolveMailboxId]);

  const printMailMessage = useCallback((messageDetail, renderedHtml = '') => {
    if (!messageDetail) return false;
    const senderLine = formatMailPersonWithEmail(
      messageDetail?.sender_person || {
        display: messageDetail?.sender_display,
        name: messageDetail?.sender_name,
        email: messageDetail?.sender_email,
      },
      String(messageDetail?.sender || '-'),
    );
    const html = String(
      renderedHtml
      || buildRenderedMailHtml(
        getMessageBodyHtmlSource(messageDetail),
        Array.isArray(messageDetail?.attachments) ? messageDetail.attachments : [],
        { allowExternalImages: true, colorScheme: 'light' },
      ).html
      || '<p>\u041d\u0435\u0442 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u043c\u043e\u0433\u043e</p>',
    );
    const printWindow = openWindow('', '_blank', 'noopener,noreferrer,width=920,height=720');
    if (!printWindow) {
      reportError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043e\u043a\u043d\u043e \u043f\u0435\u0447\u0430\u0442\u0438.');
      return false;
    }
    printWindow.document.write(buildPrintMailDocumentHtml({
      subject: messageDetail?.subject,
      senderLine,
      dateLine: formatFullDate?.(messageDetail?.received_at),
      html,
    }));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    return true;
  }, [formatFullDate, openWindow, reportError]);

  const handleOpenHeaders = useCallback(() => (
    openHeadersForMessage(selectedMessage)
  ), [openHeadersForMessage, selectedMessage]);

  const handleDownloadMessageSource = useCallback(() => (
    downloadMessageSourceForMessage(selectedMessage)
  ), [downloadMessageSourceForMessage, selectedMessage]);

  const handlePrintSelectedMessage = useCallback(() => {
    if (!selectedMessage) return false;
    return printMailMessage(selectedMessage, selectedRenderedHtml);
  }, [printMailMessage, selectedMessage, selectedRenderedHtml]);

  const handleListOpenHeaders = useCallback((item) => {
    if (!item?.id || viewMode !== 'messages') return undefined;
    return openHeadersForMessage(item);
  }, [openHeadersForMessage, viewMode]);

  const handleListDownloadMessageSource = useCallback((item) => {
    if (!item?.id || viewMode !== 'messages') return undefined;
    return downloadMessageSourceForMessage(item);
  }, [downloadMessageSourceForMessage, viewMode]);

  const handleListPrintMessage = useCallback(async (item) => {
    if (!item?.id || viewMode !== 'messages') return;
    try {
      const detail = await getMessageDetailForListAction?.(item);
      if (!detail) {
        reportError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0438\u0441\u044c\u043c\u043e \u0434\u043b\u044f \u043f\u0435\u0447\u0430\u0442\u0438.');
        return;
      }
      printMailMessage(detail);
    } catch (requestError) {
      if (!(await maybeHandleCredentials(requestError, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u043f\u0438\u0441\u044c\u043c\u043e \u043a \u043f\u0435\u0447\u0430\u0442\u0438.'))) {
        reportError(getMailErrorDetail?.(requestError, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u043f\u0438\u0441\u044c\u043c\u043e \u043a \u043f\u0435\u0447\u0430\u0442\u0438.'));
      }
    }
  }, [getMailErrorDetail, getMessageDetailForListAction, maybeHandleCredentials, printMailMessage, reportError, viewMode]);

  const fetchAttachmentBlob = useCallback(async (messageOrId, attachment, fallbackMessage = null) => {
    const { messageId, attachmentRef, mailboxId } = resolveAttachmentRequestContext(messageOrId, attachment, fallbackMessage);
    if (!messageId || !attachmentRef) {
      const contextError = buildAttachmentContextError({ attachment, messageId, mailboxId });
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Mail attachment download skipped because request context is incomplete', contextError.attachment);
      }
      throw contextError;
    }
    return mailAPI.downloadAttachment(messageId, attachmentRef, { mailboxId });
  }, [mailAPI, resolveAttachmentRequestContext]);

  const openAttachmentPreview = useCallback(async (messageOrId, attachment, fallbackMessage = null) => {
    const { messageId, attachmentRef, mailboxId } = resolveAttachmentRequestContext(
      messageOrId,
      attachment,
      fallbackMessage,
    );
    const filename = String(attachment?.name || 'attachment.bin');
    const contentType = String(attachment?.content_type || '');
    const downloadContext = { messageOrId, attachment, fallbackMessage };

    if (isOfficePreviewableAttachment(attachment)) {
      if (!messageId || !attachmentRef) {
        const contextError = buildAttachmentContextError({ attachment, messageId, mailboxId });
        reportError(contextError.message);
        return;
      }
      const officeSourceKind = getOfficeAttachmentSourceKind({ filename, contentType });
      setAttachmentPreview({
        ...createEmptyAttachmentPreview(),
        open: true,
        loading: true,
        filename,
        contentType,
        kind: officeSourceKind === 'excel' ? 'office_excel' : 'office_pdf',
        previewKind: officeSourceKind === 'excel' ? 'office_excel' : 'office_pdf',
        sourceKind: officeSourceKind,
        downloadContext,
      });
      try {
        const previewState = await buildOfficeAttachmentPreviewState({
          mailAPI,
          messageId,
          attachmentRef,
          mailboxId,
          attachment,
          filename,
          contentType,
        });
        setAttachmentPreview({
          ...createEmptyAttachmentPreview(),
          ...previewState,
          downloadContext,
        });
      } catch (requestError) {
        const errorDetail = await getMailErrorDetailAsync?.(
          requestError,
          '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u043f\u0440\u0435\u0434\u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440 Office-\u0444\u0430\u0439\u043b\u0430.',
        );
        if (!(await maybeHandleCredentials(requestError, errorDetail))) {
          setAttachmentPreview({
            ...createEmptyAttachmentPreview(),
            open: true,
            loading: false,
            error: errorDetail,
            filename,
            contentType,
            kind: 'office_pdf',
            previewKind: 'office_pdf',
            downloadContext,
          });
        }
      }
      return;
    }

    try {
      const response = await fetchAttachmentBlob(messageOrId, attachment, fallbackMessage);
      const previewState = await buildAttachmentPreviewState({
        response,
        attachment,
        createObjectUrl: typeof window.URL?.createObjectURL === 'function'
          ? window.URL.createObjectURL.bind(window.URL)
          : undefined,
      });
      setAttachmentPreview({ ...previewState, downloadContext });
    } catch (requestError) {
      const errorDetail = await getMailErrorDetailAsync?.(requestError, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u0435.');
      if (!(await maybeHandleCredentials(requestError, errorDetail))) {
        reportError(errorDetail);
      }
    }
  }, [
    fetchAttachmentBlob,
    getMailErrorDetailAsync,
    mailAPI,
    maybeHandleCredentials,
    reportError,
    resolveAttachmentRequestContext,
  ]);

  const downloadAttachmentFile = useCallback(async (messageOrId, attachment, fallbackMessage = null) => {
    const { messageId, attachmentRef, mailboxId } = resolveAttachmentRequestContext(messageOrId, attachment, fallbackMessage);
    if (!messageId || !attachmentRef) {
      const contextError = buildAttachmentContextError({ attachment, messageId, mailboxId });
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Mail attachment download skipped because request context is incomplete', contextError.attachment);
      }
      reportError(contextError.message);
      return;
    }
    const downloadKey = buildAttachmentDownloadKey({ messageId, attachmentRef, mailboxId });
    if (attachmentDownloadInFlightRef.current.has(downloadKey)) return;
    attachmentDownloadInFlightRef.current.add(downloadKey);
    try {
      const response = await mailAPI.downloadAttachment(messageId, attachmentRef, { mailboxId });
      const { blob, filename } = buildAttachmentBlobPayload({ response, attachment });
      downloadBlobFileImpl(blob, filename, { preferOpenFallback: true });
    } catch (requestError) {
      const errorDetail = await getMailErrorDetailAsync?.(requestError, '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043a\u0430\u0447\u0430\u0442\u044c \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u0435.');
      if (!(await maybeHandleCredentials(requestError, errorDetail))) {
        reportError(errorDetail);
      }
    } finally {
      attachmentDownloadInFlightRef.current.delete(downloadKey);
    }
  }, [downloadBlobFileImpl, getMailErrorDetailAsync, mailAPI, maybeHandleCredentials, reportError, resolveAttachmentRequestContext]);

  const closeAttachmentPreview = useCallback(() => {
    setAttachmentPreview(createEmptyAttachmentPreview());
  }, []);

  const downloadAttachmentPreview = useCallback(() => {
    const blob = attachmentPreview?.blob || attachmentPreview?.previewBlob;
    if (!blob) return;
    downloadBlobFileImpl(
      blob,
      attachmentPreview.filename || 'attachment.bin',
      { preferOpenFallback: true },
    );
  }, [attachmentPreview, downloadBlobFileImpl]);

  const downloadAttachmentPreviewPdf = useCallback(() => {
    if (!attachmentPreview?.previewBlob) return;
    downloadBlobFileImpl(
      attachmentPreview.previewBlob,
      attachmentPreview.pdfFilename || `${attachmentPreview.filename || 'preview'}.pdf`,
      { preferOpenFallback: true },
    );
  }, [attachmentPreview, downloadBlobFileImpl]);

  const headersForDialog = useMemo(
    () => (headersLoading ? HEADERS_LOADING_ITEMS : messageHeaders),
    [headersLoading, messageHeaders],
  );

  return {
    headersOpen,
    headersForDialog,
    closeHeadersDialog,
    attachmentPreview,
    closeAttachmentPreview,
    downloadAttachmentPreview,
    downloadAttachmentPreviewPdf,
    handleOpenHeaders,
    handleDownloadMessageSource,
    handlePrintSelectedMessage,
    handleListOpenHeaders,
    handleListDownloadMessageSource,
    handleListPrintMessage,
    fetchAttachmentBlob,
    openAttachmentPreview,
    downloadAttachmentFile,
    maxPreviewFileBytes: MAX_PREVIEW_FILE_BYTES,
  };
}
