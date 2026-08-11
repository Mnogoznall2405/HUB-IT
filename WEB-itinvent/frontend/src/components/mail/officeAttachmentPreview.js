import {
  buildAttachmentBlobPayload,
  getOfficeAttachmentSourceKind,
  normalizeAttachmentPreviewMetadata,
} from './mailMessageFileActions';
import { parseExcelWorkbookFromBlob } from '../../lib/excelPreview';
import { waitForAttachmentPreview } from '../documentPreview/asyncAttachmentPreview';

export const buildOfficeAttachmentPreviewState = async ({
  mailAPI,
  messageId,
  attachmentRef,
  mailboxId,
  attachment,
  filename,
  contentType,
  previewMetadata = null,
  signal,
  createObjectUrl = (blob) => (
    typeof globalThis.URL?.createObjectURL === 'function'
      ? globalThis.URL.createObjectURL(blob)
      : ''
  ),
}) => {
  const officeSourceKind = getOfficeAttachmentSourceKind({ filename, contentType });
  const requestOptions = signal ? { mailboxId, signal } : { mailboxId };
  let metadataPromise = null;
  const loadPreviewMetadata = () => {
    if (previewMetadata) return Promise.resolve(previewMetadata);
    if (!metadataPromise) {
      metadataPromise = waitForAttachmentPreview({
        previewAPI: {
          getAttachmentPreview: (_messageId, _attachmentRef, { signal: pollingSignal } = {}) => (
            mailAPI.getAttachmentPreview(messageId, attachmentRef, {
              mailboxId,
              signal: pollingSignal,
            })
          ),
        },
        parentId: messageId,
        attachmentId: attachmentRef,
        signal,
      });
    }
    return metadataPromise;
  };

  if (officeSourceKind === 'excel') {
    try {
      const attachmentResponse = await mailAPI.downloadAttachment(messageId, attachmentRef, requestOptions);
      const { blob } = buildAttachmentBlobPayload({ response: attachmentResponse, attachment });
      const excelWorkbook = await parseExcelWorkbookFromBlob(blob);
      let pdfPreview = null;
      try {
        const metadata = await loadPreviewMetadata();
        const pdfResponse = await mailAPI.downloadAttachmentPreviewPdf(messageId, attachmentRef, requestOptions);
        const normalized = normalizeAttachmentPreviewMetadata(metadata);
        const { blob: previewBlob, filename: pdfFilename, contentType: pdfContentType } = buildAttachmentBlobPayload({
          response: pdfResponse,
          attachment: {
            name: normalized.pdfFilename || `${filename.replace(/\.[^.]+$/, '') || 'preview'}.pdf`,
            content_type: 'application/pdf',
          },
        });
        pdfPreview = {
          objectUrl: createObjectUrl(previewBlob),
          previewBlob,
          pageCount: normalized.pageCount,
          sheets: normalized.sheets,
          pdfFilename: pdfFilename || normalized.pdfFilename,
          pdfContentType,
        };
      } catch {
        pdfPreview = null;
      }
      return {
        open: true,
        loading: false,
        error: '',
        filename,
        contentType,
        kind: 'office_excel',
        previewKind: 'office_excel',
        sourceKind: 'excel',
        blob,
        excelWorkbook,
        objectUrl: pdfPreview?.objectUrl || '',
        previewBlob: pdfPreview?.previewBlob || null,
        pageCount: pdfPreview?.pageCount || 0,
        sheets: pdfPreview?.sheets || [],
        pdfFilename: pdfPreview?.pdfFilename || '',
        pdfContentType: pdfPreview?.pdfContentType || 'application/pdf',
      };
    } catch {
      // Fall back to server-side PDF preview below.
    }
  }

  const metadata = await loadPreviewMetadata();
  const normalized = normalizeAttachmentPreviewMetadata(metadata);
  const pdfResponse = await mailAPI.downloadAttachmentPreviewPdf(messageId, attachmentRef, requestOptions);
  const { blob, filename: pdfFilename, contentType: pdfContentType } = buildAttachmentBlobPayload({
    response: pdfResponse,
    attachment: {
      name: `${filename.replace(/\.[^.]+$/, '') || 'preview'}.pdf`,
      content_type: 'application/pdf',
    },
  });

  return {
    open: true,
    loading: false,
    error: '',
    filename,
    contentType,
    kind: 'office_pdf',
    objectUrl: createObjectUrl(blob),
    previewBlob: blob,
    sourceKind: officeSourceKind,
    previewKind: 'office_pdf',
    pageCount: normalized.pageCount,
    sheets: normalized.sheets,
    pdfFilename: pdfFilename || normalized.pdfFilename,
    pdfContentType,
    blob: null,
    excelWorkbook: null,
  };
};

export const buildOfficeInlinePreviewState = async ({
  mailAPI,
  messageId,
  attachmentRef,
  mailboxId,
  attachment,
  filename,
  contentType,
}) => {
  const officeSourceKind = getOfficeAttachmentSourceKind({ filename, contentType });

  if (officeSourceKind !== 'excel') {
    return {
      kind: 'office_placeholder',
      sourceKind: officeSourceKind,
    };
  }

  try {
    const attachmentResponse = await mailAPI.downloadAttachment(messageId, attachmentRef, { mailboxId });
    const { blob } = buildAttachmentBlobPayload({ response: attachmentResponse, attachment });
    const excelWorkbook = await parseExcelWorkbookFromBlob(blob);
    return {
      kind: 'office_excel',
      sourceKind: 'excel',
      excelWorkbook,
    };
  } catch {
    return {
      kind: 'office_placeholder',
      sourceKind: 'excel',
    };
  }
};
