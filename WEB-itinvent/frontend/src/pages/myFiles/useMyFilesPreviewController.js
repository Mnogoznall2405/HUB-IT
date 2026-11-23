import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';

import { myFilesAPI } from '../../api/myFiles';
import { myFilesOfficeAPI } from '../../api/myFilesOffice';
import { canOpenInDesktopApplication } from '../../components/fileActions/FileActionsContextMenu';
import { openOriginalWithDesktopApplication } from '../../components/documentPreview/desktopOfficeOpen';
import {
  buildAttachmentBlobPayload,
  downloadBlobFile,
  getOfficeViewSourceKind,
  normalizeAttachmentPreviewMetadata,
} from '../../components/mail/mailMessageFileActions';
import { parseCsvTextToWorkbook, parseExcelWorkbookFromBlob } from '../../lib/excelPreview';
import {
  createEmptyDocumentPreviewState,
  getMyFileContentType,
  getMyFileName,
  getMyFilePreviewKind,
  resolveMyFilePreviewError,
} from '../../lib/myFilesPreview';
import {
  decodeTextBuffer,
  fetchTextWithLimit,
  getTextLanguage,
  TEXT_PREVIEW_MAX_BYTES,
} from '../../lib/textPreview';
import useRequestGuard from '../../lib/useRequestGuard';

export function useMyFilesPreviewController({ downloadFile }) {
  const officeUiTheme = useTheme().palette.mode === 'dark' ? 'theme-dark' : 'theme-light';
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
    const fallbackSourceKind = getOfficeViewSourceKind({ filename: fileName, contentType });
    const fallbackKind = getMyFilePreviewKind(item);
    const nativeKind = ['text', 'markdown', 'csv'].includes(fallbackKind) ? fallbackKind : '';

    revokePreviewObjectUrl();
    setDocumentPreview({
      ...createEmptyDocumentPreviewState(),
      open: true,
      item,
      loading: true,
      kind: fallbackKind,
      sourceKind: nativeKind ? '' : fallbackSourceKind,
    });

    // Prepared-PDF/excel fallback: used when the viewer config is unavailable
    // or the DocEditor frame itself fails after a successful config fetch.
    const loadPreparedPreview = async () => {
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
    };

    try {
      // Native text/Markdown/CSV preview: authenticated download-grant bytes,
      // decoded locally, capped at TEXT_PREVIEW_MAX_BYTES (the reader is
      // cancelled past the limit instead of buffering the whole file).
      if (nativeKind) {
        const grant = await myFilesAPI.createDownloadGrant(fileId);
        const grantUrl = myFilesAPI.buildDownloadGrantUrl(grant?.download_path);
        if (!grantUrl) throw new Error('preview source is unavailable');
        const { buffer, truncated, totalBytes } = await fetchTextWithLimit(grantUrl, {
          maxBytes: TEXT_PREVIEW_MAX_BYTES,
        });
        if (!isCurrent()) return;
        if (nativeKind === 'csv') {
          const decoded = decodeTextBuffer(buffer);
          const excelWorkbook = await parseCsvTextToWorkbook(decoded.text);
          if (!isCurrent()) return;
          setDocumentPreview({
            ...createEmptyDocumentPreviewState(),
            open: true,
            item,
            loading: false,
            kind: 'csv',
            sourceKind: 'csv',
            excelWorkbook,
            textPreview: { text: '', encoding: decoded.encoding, truncated, totalBytes },
          });
          return;
        }
        const { text, encoding } = decodeTextBuffer(buffer);
        setDocumentPreview({
          ...createEmptyDocumentPreviewState(),
          open: true,
          item,
          loading: false,
          kind: nativeKind,
          sourceKind: '',
          textPreview: {
            text,
            encoding,
            truncated,
            totalBytes,
            language: getTextLanguage(fileName),
          },
        });
        return;
      }

      // Office documents open directly in the read-only DocEditor viewer:
      // no conversion round-trip and no editing session. Falls back to the
      // prepared PDF preview when Document Server is unavailable — both when
      // the config fetch fails and when the frame itself cannot render.
      if (fallbackSourceKind) {
        try {
          const viewPayload = await myFilesOfficeAPI.getViewConfig(fileId, { uiTheme: officeUiTheme });
          if (!isCurrent()) return;
          setDocumentPreview({
            open: true,
            item,
            loading: false,
            error: '',
            kind: 'office_view',
            sourceKind: fallbackSourceKind,
            officeView: {
              config: viewPayload.config,
              publicPath: viewPayload.public_path,
              onError: () => {
                if (!isCurrent()) return;
                setDocumentPreview((current) => ({
                  ...current,
                  loading: true,
                  officeView: null,
                }));
                void loadPreparedPreview().catch((error) => {
                  if (!isCurrent()) return;
                  setDocumentPreview((current) => ({
                    ...current,
                    loading: false,
                    error: resolveMyFilePreviewError(error, item),
                  }));
                });
              },
            },
          });
          return;
        } catch {
          // Viewer config unavailable — continue with the prepared-PDF path.
        }
      }

      await loadPreparedPreview();
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
