import { useCallback, useEffect, useRef, useState } from 'react';

import { myFilesAPI } from '../../api/myFiles';
import { canOpenInDesktopApplication } from '../../components/fileActions/FileActionsContextMenu';
import { openOriginalWithDesktopApplication } from '../../components/documentPreview/desktopOfficeOpen';
import {
  buildAttachmentBlobPayload,
  downloadBlobFile,
  getOfficeAttachmentSourceKind,
  normalizeAttachmentPreviewMetadata,
} from '../../components/mail/mailMessageFileActions';
import { parseExcelWorkbookFromBlob } from '../../lib/excelPreview';
import {
  createEmptyDocumentPreviewState,
  getMyFileContentType,
  getMyFileName,
  getMyFilePreviewKind,
  resolveMyFilePreviewError,
} from '../../lib/myFilesPreview';
import useRequestGuard from '../../lib/useRequestGuard';

export function useMyFilesPreviewController({ downloadFile }) {
  const previewObjectUrlRef = useRef('');
  const [documentPreview, setDocumentPreview] = useState(createEmptyDocumentPreviewState);
  const beginPreview = useRequestGuard();

  const revokePreviewObjectUrl = useCallback(() => {
    const currentUrl = previewObjectUrlRef.current;
    if (currentUrl && typeof window !== 'undefined' && typeof window.URL?.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(currentUrl);
    }
    previewObjectUrlRef.current = '';
  }, []);

  useEffect(() => () => {
    revokePreviewObjectUrl();
  }, [revokePreviewObjectUrl]);

  const openDocumentPreview = useCallback(async (item, { forcePreview = false } = {}) => {
    const isCurrent = beginPreview();
    const fileId = String(item?.id || '').trim();
    if (!fileId) return;

    const fileName = getMyFileName(item);
    const contentType = getMyFileContentType(item);
    // Mail parity: inside HUB Desktop an office/pdf file opens in the
    // associated application directly instead of the in-app preview.
    if (!forcePreview && canOpenInDesktopApplication(fileName)) {
      const desktopOpen = await openOriginalWithDesktopApplication({
        onDownload: () => downloadFile(item),
      });
      if (desktopOpen.accepted) return;
    }
    const fallbackSourceKind = getOfficeAttachmentSourceKind({ filename: fileName, contentType });
    const fallbackKind = getMyFilePreviewKind(item);

    revokePreviewObjectUrl();
    setDocumentPreview({
      ...createEmptyDocumentPreviewState(),
      open: true,
      item,
      loading: true,
      kind: fallbackKind,
      sourceKind: fallbackSourceKind,
    });

    try {
      const metadata = normalizeAttachmentPreviewMetadata(await myFilesAPI.getPreviewMeta(fileId));
      if (!isCurrent()) return;
      const resolvedSourceKind = metadata.sourceKind || fallbackSourceKind;
      const previewResponse = await myFilesAPI.downloadPreviewContent(fileId);
      if (!isCurrent()) return;
      const {
        blob: previewBlob,
        filename: previewFilename,
      } = buildAttachmentBlobPayload({
        response: previewResponse,
        attachment: {
          name: metadata.pdfFilename || fileName,
          content_type: 'application/pdf',
        },
      });
      let excelWorkbook = null;
      if (resolvedSourceKind === 'excel') {
        try {
          const sourceResponse = await myFilesAPI.downloadPreviewSource(fileId);
          const { blob: sourceBlob } = buildAttachmentBlobPayload({
            response: sourceResponse,
            attachment: { name: fileName, content_type: contentType },
          });
          excelWorkbook = await parseExcelWorkbookFromBlob(sourceBlob);
        } catch {
          excelWorkbook = null;
        }
      }

      if (!isCurrent()) return;
      const objectUrl = typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function'
        ? window.URL.createObjectURL(previewBlob)
        : '';
      previewObjectUrlRef.current = objectUrl;
      setDocumentPreview({
        open: true,
        item,
        loading: false,
        error: '',
        kind: resolvedSourceKind === 'excel' && excelWorkbook ? 'office_excel' : (metadata.previewKind || fallbackKind),
        sourceKind: resolvedSourceKind,
        objectUrl,
        previewBlob,
        excelWorkbook,
        pageCount: metadata.pageCount,
        sheets: metadata.sheets,
        pdfFilename: previewFilename || metadata.pdfFilename,
      });
    } catch (error) {
      if (!isCurrent()) return;
      setDocumentPreview((current) => ({
        ...current,
        loading: false,
        error: resolveMyFilePreviewError(error, item),
        objectUrl: '',
        previewBlob: null,
        excelWorkbook: null,
      }));
    }
  }, [beginPreview, downloadFile, revokePreviewObjectUrl]);

  const closeDocumentPreview = useCallback(() => {
    beginPreview();
    revokePreviewObjectUrl();
    setDocumentPreview(createEmptyDocumentPreviewState());
  }, [beginPreview, revokePreviewObjectUrl]);

  const refreshDocumentPreview = useCallback(() => {
    if (!documentPreview.item) return;
    void openDocumentPreview(documentPreview.item, { forcePreview: true });
  }, [documentPreview.item, openDocumentPreview]);

  const downloadDocumentPreviewPdf = useCallback(() => {
    if (!documentPreview.previewBlob) return;
    const fileName = getMyFileName(documentPreview.item);
    downloadBlobFile(
      documentPreview.previewBlob,
      documentPreview.pdfFilename || `${fileName.replace(/\.[^.]+$/, '') || 'preview'}.pdf`,
      { preferOpenFallback: true },
    );
  }, [documentPreview.item, documentPreview.pdfFilename, documentPreview.previewBlob]);

  return {
    documentPreview,
    openDocumentPreview,
    closeDocumentPreview,
    refreshDocumentPreview,
    downloadDocumentPreviewPdf,
  };
}
