import { waitForAttachmentPreview } from '../../components/documentPreview/asyncAttachmentPreview';
import {
  buildAttachmentBlobPayload,
  buildAttachmentPreviewState,
  createEmptyAttachmentPreview,
  getOfficeAttachmentSourceKind,
  normalizeAttachmentPreviewMetadata,
} from '../../components/mail/mailMessageFileActions';

export const loadWarehouseMovementFilePreview = async ({
  registrarRef,
  file,
  api,
  createObjectUrl,
  signal,
} = {}) => {
  const fileRef = String(file?.ref || '').trim();
  const filename = String(file?.name || 'document.bin').trim() || 'document.bin';
  const contentType = String(file?.content_type || 'application/octet-stream');
  const downloadContext = { registrarRef, file };
  const officeSourceKind = getOfficeAttachmentSourceKind({ filename, contentType });

  if (officeSourceKind) {
    const metadata = await waitForAttachmentPreview({
      previewAPI: {
        getAttachmentPreview: (_registrarRef, _fileRef, { signal: pollSignal } = {}) => (
          api.getMovementFilePreview(registrarRef, fileRef, { signal: pollSignal })
        ),
      },
      parentId: registrarRef,
      attachmentId: fileRef,
      signal,
    });
    const response = await api.downloadMovementFilePreviewPdf(registrarRef, fileRef);
    const { blob, filename: responsePdfFilename, contentType: pdfContentType } = buildAttachmentBlobPayload({
      response,
      attachment: {
        name: `${filename.replace(/\.[^.]+$/, '') || 'preview'}.pdf`,
        content_type: 'application/pdf',
      },
    });
    const normalizedMetadata = normalizeAttachmentPreviewMetadata(metadata);
    return {
      ...createEmptyAttachmentPreview(),
      open: true,
      filename,
      contentType,
      kind: 'office_pdf',
      previewKind: 'office_pdf',
      sourceKind: normalizedMetadata.sourceKind
        || String(response?.headers?.['x-warehouse-preview-source-kind'] || officeSourceKind),
      objectUrl: typeof createObjectUrl === 'function' ? createObjectUrl(blob) : '',
      previewBlob: blob,
      pdfFilename: normalizedMetadata.pdfFilename || responsePdfFilename,
      pdfContentType,
      pageCount: normalizedMetadata.pageCount
        || Number(response?.headers?.['x-warehouse-preview-page-count'] || 0),
      sheets: normalizedMetadata.sheets,
      downloadContext,
    };
  }

  const response = await api.downloadMovementFile(registrarRef, fileRef);
  const preview = await buildAttachmentPreviewState({
    response,
    attachment: {
      name: filename,
      content_type: contentType,
      size: file?.size || 0,
    },
    createObjectUrl,
  });
  return { ...preview, downloadContext };
};
