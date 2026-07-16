import {
  buildAttachmentBlobPayload,
  getOfficeAttachmentSourceKind,
  normalizeAttachmentPreviewMetadata,
} from './mailMessageFileActions';
import { parseExcelWorkbookFromBlob } from '../../lib/excelPreview';

export const buildOfficeAttachmentPreviewState = async ({
  mailAPI,
  messageId,
  attachmentRef,
  mailboxId,
  attachment,
  filename,
  contentType,
  createObjectUrl = (blob) => (
    typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function'
      ? window.URL.createObjectURL(blob)
      : ''
  ),
}) => {
  const officeSourceKind = getOfficeAttachmentSourceKind({ filename, contentType });

  if (officeSourceKind === 'excel') {
    try {
      const attachmentResponse = await mailAPI.downloadAttachment(messageId, attachmentRef, { mailboxId });
      const { blob } = buildAttachmentBlobPayload({ response: attachmentResponse, attachment });
      const excelWorkbook = await parseExcelWorkbookFromBlob(blob);
      let pdfPreview = null;
      try {
        const metadata = await mailAPI.getAttachmentPreview(messageId, attachmentRef, { mailboxId });
        const pdfResponse = await mailAPI.downloadAttachmentPreviewPdf(messageId, attachmentRef, { mailboxId });
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

  const pdfResponse = await mailAPI.downloadAttachmentPreviewPdf(messageId, attachmentRef, { mailboxId });
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
    pageCount: 0,
    sheets: [],
    pdfFilename,
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
