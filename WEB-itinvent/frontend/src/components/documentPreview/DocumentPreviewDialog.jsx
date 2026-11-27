import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import RotateLeftRoundedIcon from '@mui/icons-material/RotateLeftRounded';
import RotateRightRoundedIcon from '@mui/icons-material/RotateRightRounded';
import {
  requestDesktopDownloadedFileAction,
  requestDesktopPrintDocument,
  isDesktopCapabilityAvailable,
} from '../../lib/desktopBridge';
import { isNativeShellRuntime } from '../../lib/platform';
import {
  buildPrintDocumentHtml,
  buildSheetsPrintBodyHtml,
  buildTextPrintBodyHtml,
  escapeHtml,
  printHtmlDocument,
  printPdfDocument,
  sheetsPrintLosesRows,
} from '../../lib/documentPrint';
import { getDesktopOfficeOpenLabel, openOriginalWithDesktopApplication } from './desktopOfficeOpen';

const MailPdfPreviewSurface = lazy(() => import('../mail/MailPdfPreviewSurface'));
const MailExcelPreviewGrid = lazy(() => import('../mail/MailExcelPreviewGrid'));
const OfficeViewFrame = lazy(() => import('./OfficeViewFrame'));
const CodeMirrorTextViewer = lazy(() => import('./CodeMirrorTextViewer'));
const MarkdownFileViewer = lazy(() => import('./MarkdownFileViewer'));

const DOCUMENT_PREVIEW_KINDS = new Set([
  'pdf', 'office_pdf', 'office_excel', 'office_view',
  'text', 'markdown', 'csv',
]);

const surfaceFallback = (
  <Skeleton variant="rectangular" height={420} sx={{ borderRadius: '8px' }} />
);

export const isDocumentPreviewKind = (kind) => DOCUMENT_PREVIEW_KINDS.has(String(kind || ''));

export default function DocumentPreviewDialog({
  open,
  title = '',
  subtitle = '',
  kind = 'unsupported',
  sourceKind = '',
  objectUrl = '',
  excelWorkbook = null,
  officeView = null,
  textPreview = null,
  pageCount = 0,
  sheets = [],
  loading = false,
  error = '',
  onClose,
  onRefresh,
  onDownloadOriginal,
  onDownloadPdf,
  canDownloadOriginal = true,
  canDownloadPdf = false,
  originalLabel = 'Оригинал',
  pdfLabel = 'PDF-версия',
  desktopOpenFileName = '',
  desktopOpenDownloadRef = '',
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isExcel = sourceKind === 'excel' || sourceKind === 'csv' || kind === 'office_excel' || kind === 'csv';
  const hasExcelTable = Boolean(isExcel && excelWorkbook);
  const hasOfficeView = Boolean(kind === 'office_view' && officeView?.config && officeView?.publicPath);
  const hasPdfPreview = Boolean(objectUrl && (kind === 'pdf' || kind === 'office_pdf' || isExcel));
  const hasImagePreview = Boolean(objectUrl && kind === 'image');
  const hasMarkdownPreview = Boolean(kind === 'markdown' && textPreview);
  const hasTextPreview = Boolean(kind === 'text' && textPreview);
  const canOpenInDesktopApplication = Boolean(onDownloadOriginal && canDownloadOriginal && isNativeShellRuntime());
  const desktopOpenLabel = getDesktopOfficeOpenLabel(sourceKind);
  const preferredMode = hasExcelTable ? 'table' : 'pdf';
  const [mode, setMode] = useState(preferredMode);
  const [rotation, setRotation] = useState(0);
  const [requestingDesktopOpen, setRequestingDesktopOpen] = useState(false);
  const [desktopOpenMessage, setDesktopOpenMessage] = useState('');
  const [printError, setPrintError] = useState('');
  const [sheetsPrintConfirm, setSheetsPrintConfirm] = useState(false);

  useEffect(() => {
    if (open) setMode(preferredMode);
  }, [open, preferredMode]);

  useEffect(() => {
    if (open) setRotation(0);
  }, [objectUrl, open]);

  useEffect(() => {
    setRequestingDesktopOpen(false);
    setDesktopOpenMessage('');
    setPrintError('');
    setSheetsPrintConfirm(false);
  }, [open, title]);

  const openOriginalInDesktopApplication = useCallback(async () => {
    setRequestingDesktopOpen(true);
    setDesktopOpenMessage('');
    const normalizedRef = String(desktopOpenDownloadRef || '').trim();
    const result = await openOriginalWithDesktopApplication({
      requestOpen: (action, name, ref) => requestDesktopDownloadedFileAction(action, name, ref),
      onDownload: () => {
        // Exact binding needs the shell to see the canonical attachment URL
        // in the download. Blob-based downloads get random object URLs, so
        // when the caller supplies the path we download it directly with an
        // anchor, exactly like the chat context menu does.
        if (normalizedRef.startsWith('/')) {
          const link = document.createElement('a');
          link.href = normalizedRef;
          link.download = String(desktopOpenFileName || title || 'attachment.bin');
          link.rel = 'noreferrer';
          document.body.appendChild(link);
          link.click();
          link.remove();
          return undefined;
        }
        return onDownloadOriginal?.();
      },
      fileName: desktopOpenFileName || title,
      downloadRef: desktopOpenDownloadRef,
    });
    setRequestingDesktopOpen(false);
    if (!result.accepted) {
      setDesktopOpenMessage(
        result.status === 'busy'
          ? 'Другая загрузка уже ожидает открытия'
          : 'Не удалось передать открытие в HUB Desktop',
      );
    }
  }, [onDownloadOriginal]);

  const rotateLeft = useCallback(() => {
    setRotation((current) => (current + 270) % 360);
  }, []);

  const rotateRight = useCallback(() => {
    setRotation((current) => (current + 90) % 360);
  }, []);

  const showModeTabs = hasExcelTable && hasPdfPreview;
  const resolvedMode = hasExcelTable && mode === 'table' ? 'table' : 'pdf';
  const heading = title || 'Документ';
  const subheading = subtitle || (hasOfficeView ? 'Просмотр (только чтение)' : hasMarkdownPreview ? 'Markdown' : hasTextPreview ? 'Текст' : kind === 'csv' ? 'CSV-таблица' : isExcel ? 'Excel' : kind === 'office_pdf' ? 'PDF-предпросмотр' : 'PDF');

  const openOriginalExternally = useCallback(() => {
    if (canOpenInDesktopApplication) {
      openOriginalInDesktopApplication();
      return;
    }
    if (objectUrl) {
      window.open(objectUrl, '_blank', 'noopener');
    }
  }, [canOpenInDesktopApplication, objectUrl, openOriginalInDesktopApplication]);

  // Resolve what to print BEFORE dispatching. There is deliberately no
  // window.print() fallback: printing the app DOM rasterizes the preview
  // canvas and drops pages — a failure must surface an error + download
  // actions instead.
  const resolvePrintJob = useCallback(async ({ skipSheetsConfirm = false } = {}) => {
    if (objectUrl && (hasPdfPreview || kind === 'pdf' || kind === 'office_pdf')
      && resolvedMode !== 'table') {
      return { type: 'pdf', url: objectUrl };
    }
    if (hasMarkdownPreview && textPreview) {
      const { buildMarkdownPrintBodyHtml } = await import('../../lib/markdownPrint');
      return {
        type: 'html',
        bodyHtml: buildMarkdownPrintBodyHtml(textPreview.text, { truncated: textPreview.truncated }),
      };
    }
    if (hasTextPreview && textPreview) {
      return {
        type: 'html',
        bodyHtml: buildTextPrintBodyHtml({ text: textPreview.text, truncated: textPreview.truncated }),
      };
    }
    if (hasImagePreview && objectUrl) {
      return {
        type: 'html',
        bodyHtml: `<img src="${escapeHtml(objectUrl)}" alt="${escapeHtml(heading)}" style="max-width:100%;height:auto">`,
      };
    }
    if (resolvedMode === 'table' && hasExcelTable) {
      if (!skipSheetsConfirm && sheetsPrintLosesRows({ sheets: excelWorkbook?.sheets })) {
        return { type: 'sheets-confirm' };
      }
      return { type: 'html', bodyHtml: buildSheetsPrintBodyHtml({ sheets: excelWorkbook?.sheets }) };
    }
    return null;
  }, [
    excelWorkbook,
    hasExcelTable,
    hasImagePreview,
    hasMarkdownPreview,
    hasPdfPreview,
    hasTextPreview,
    heading,
    kind,
    objectUrl,
    resolvedMode,
    textPreview,
  ]);

  const printPreview = useCallback(async (options) => {
    setPrintError('');
    setSheetsPrintConfirm(false);
    const job = await resolvePrintJob(options);
    if (job?.type === 'sheets-confirm') {
      setSheetsPrintConfirm(true);
      return;
    }
    if (!job) {
      setPrintError('no-source');
      return;
    }

    if (isDesktopCapabilityAvailable('print-document')) {
      try {
        if (job.type === 'html') {
          window.__hubPendingPrintHtml = buildPrintDocumentHtml({
            title: heading,
            bodyHtml: job.bodyHtml,
          });
        }
        const result = await requestDesktopPrintDocument({
          kind: job.type,
          url: job.url || '',
          title: heading,
        });
        if (!result.accepted) {
          setPrintError(result.status === 'too-large' ? 'too-large' : 'failed');
        }
      } catch {
        setPrintError('failed');
      } finally {
        try { delete window.__hubPendingPrintHtml; } catch { /* noop */ }
      }
      return;
    }

    // Desktop without the print-document capability cannot print the document
    // — an in-page iframe print inside WebView2 targets the portal DOM.
    if (isNativeShellRuntime()) {
      setPrintError('desktop-unsupported');
      return;
    }

    try {
      if (job.type === 'pdf') {
        // Original PDF bytes → the browser's own PDF viewer (hidden blob iframe).
        await printPdfDocument({ url: job.url, title: heading });
      } else {
        await printHtmlDocument({ title: heading, bodyHtml: job.bodyHtml });
      }
    } catch {
      setPrintError('failed');
    }
  }, [
    heading,
    resolvePrintJob,
  ]);

  const body = useMemo(() => {
    if (loading) {
      return (
        <Stack spacing={1.25} sx={{ p: { xs: 1.25, sm: 2 } }}>
          <Skeleton variant="text" width="34%" />
          <Skeleton variant="rectangular" height={isMobile ? 460 : 560} sx={{ borderRadius: '8px' }} />
        </Stack>
      );
    }

    if (error) {
      return (
        <Stack spacing={1.5} sx={{ p: { xs: 1.25, sm: 2 } }}>
          <Alert severity="warning">{error}</Alert>
          {onRefresh ? (
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon />}
              onClick={onRefresh}
              sx={{ alignSelf: 'flex-start', textTransform: 'none', borderRadius: '8px', fontWeight: 700 }}
            >
              Обновить
            </Button>
          ) : null}
        </Stack>
      );
    }

    if (hasOfficeView) {
      return (
        <Suspense fallback={surfaceFallback}>
          <OfficeViewFrame
            config={officeView.config}
            publicPath={officeView.publicPath}
            onError={officeView.onError}
          />
        </Suspense>
      );
    }

    if (hasMarkdownPreview) {
      return (
        <Suspense fallback={surfaceFallback}>
          <MarkdownFileViewer
            value={textPreview.text}
            fileName={heading}
            encoding={textPreview.encoding}
            truncated={textPreview.truncated}
          />
        </Suspense>
      );
    }

    if (hasTextPreview) {
      return (
        <Suspense fallback={surfaceFallback}>
          <CodeMirrorTextViewer
            value={textPreview.text}
            fileName={heading}
            language={textPreview.language}
            encoding={textPreview.encoding}
            truncated={textPreview.truncated}
          />
        </Suspense>
      );
    }

    if (hasImagePreview) {
      return (
        <Box sx={{
          minHeight: 0,
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          p: { xs: 1, sm: 1.5 },
        }}
        >
          <Box
            component="img"
            src={objectUrl}
            alt={heading}
            sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px' }}
          />
        </Box>
      );
    }

    if (resolvedMode === 'table' && hasExcelTable) {
      return (
        <Box sx={{ p: { xs: 1, sm: 1.5 }, minHeight: 0, flex: 1, overflow: 'auto' }}>
          <Suspense fallback={surfaceFallback}>
            <MailExcelPreviewGrid workbook={excelWorkbook} compact={false} />
          </Suspense>
        </Box>
      );
    }

    if (hasPdfPreview) {
      return (
        <Box sx={{
          minHeight: 0,
          flex: 1,
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        >
          <Suspense fallback={surfaceFallback}>
            <MailPdfPreviewSurface
              objectUrl={objectUrl}
              filename={heading}
              sourceKind={sourceKind}
              sheets={sheets}
              pageCount={pageCount}
              initialPage={1}
              compact={false}
              fillContainer
              rotation={rotation}
            />
          </Suspense>
        </Box>
      );
    }

    return (
      <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight: 360, p: 2 }}>
        <Alert severity="info" sx={{ width: '100%' }}>
          Предпросмотр готовится или временно недоступен. Оригинал можно скачать.
        </Alert>
      </Stack>
    );
  }, [
    error,
    excelWorkbook,
    hasExcelTable,
    hasImagePreview,
    hasMarkdownPreview,
    hasOfficeView,
    hasPdfPreview,
    hasTextPreview,
    officeView,
    heading,
    isMobile,
    loading,
    onRefresh,
    pageCount,
    resolvedMode,
    rotation,
    sheets,
    sourceKind,
    objectUrl,
    textPreview,
  ]);

  return (
    <Dialog
      open={Boolean(open)}
      onClose={onClose}
      fullScreen
      maxWidth={false}
      sx={{
        // Fullscreen document previews can be opened from dialogs that already
        // use elevated modal layers. Keep the preview above them while leaving
        // the tooltip layer available for its toolbar controls.
        zIndex: (activeTheme) => `${activeTheme.zIndex.tooltip - 1} !important`,
      }}
      PaperProps={{
        sx: {
          width: '100%',
          height: '100dvh',
          maxHeight: '100dvh',
          m: 0,
          borderRadius: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle
        sx={{
          px: { xs: 1, sm: 1.5 },
          pt: { xs: 1, sm: 1.25 },
          pb: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          top: 0,
          zIndex: 2,
          bgcolor: 'background.paper',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Tooltip title={isMobile ? 'Назад' : 'Закрыть'}>
            <IconButton edge="start" onClick={onClose} aria-label={isMobile ? 'Назад' : 'Закрыть'}>
              {isMobile ? <ArrowBackRoundedIcon /> : <CloseRoundedIcon />}
            </IconButton>
          </Tooltip>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              {heading}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {subheading}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} alignItems="center">
            {hasPdfPreview && resolvedMode === 'pdf' ? (
              <>
                <Tooltip title="Повернуть влево">
                  <span>
                    <IconButton onClick={rotateLeft} disabled={loading} aria-label="Повернуть влево">
                      <RotateLeftRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Повернуть вправо">
                  <span>
                    <IconButton onClick={rotateRight} disabled={loading} aria-label="Повернуть вправо">
                      <RotateRightRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            ) : null}
            {onRefresh ? (
              <Tooltip title="Обновить">
                <span>
                  <IconButton onClick={onRefresh} disabled={loading} aria-label="Обновить">
                    {loading ? <CircularProgress size={20} /> : <RefreshRoundedIcon />}
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            {(hasPdfPreview || hasExcelTable || hasMarkdownPreview || hasTextPreview || hasImagePreview) && !loading ? (
              <Tooltip title="Печать">
                <IconButton onClick={() => { void printPreview(); }} aria-label="Печать">
                  <PrintRoundedIcon />
                </IconButton>
              </Tooltip>
            ) : null}
            {onDownloadPdf && canDownloadPdf ? (
              <Tooltip title={pdfLabel}>
                <span>
                  <IconButton onClick={onDownloadPdf} disabled={loading} aria-label={pdfLabel}>
                    <PictureAsPdfRoundedIcon />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            {onDownloadOriginal && canDownloadOriginal ? (
              canOpenInDesktopApplication ? (
                <Tooltip title={desktopOpenLabel}>
                  <span>
                    <IconButton
                      onClick={openOriginalInDesktopApplication}
                      disabled={loading || requestingDesktopOpen}
                      aria-label={desktopOpenLabel}
                    >
                      <OpenInNewRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null
            ) : null}
            {onDownloadOriginal && canDownloadOriginal ? (
              <Tooltip title={originalLabel}>
                <span>
                  <IconButton onClick={onDownloadOriginal} disabled={loading} aria-label={originalLabel}>
                    <DownloadRoundedIcon />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
          </Stack>
        </Stack>
      </DialogTitle>

      {desktopOpenMessage ? (
        <Alert
          severity="info"
          role="status"
          aria-live="polite"
          sx={{ borderRadius: 0 }}
        >
          {desktopOpenMessage}
        </Alert>
      ) : null}

      {printError ? (
        <Alert
          severity="error"
          role="alert"
          sx={{ borderRadius: 0 }}
          action={(
            <Stack direction="row" spacing={1}>
              {objectUrl || canOpenInDesktopApplication ? (
                <Button
                  size="small"
                  color="inherit"
                  onClick={openOriginalExternally}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Открыть оригинал
                </Button>
              ) : null}
              {onDownloadOriginal && canDownloadOriginal ? (
                <Button
                  size="small"
                  color="inherit"
                  onClick={onDownloadOriginal}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Скачать оригинал
                </Button>
              ) : null}
            </Stack>
          )}
          onClose={() => setPrintError('')}
        >
          {printError === 'too-large'
            ? 'Файл слишком велик для печати из предпросмотра.'
            : 'Не удалось распечатать документ. Откройте или скачайте оригинал и распечатайте его в приложении.'}
        </Alert>
      ) : null}

      {sheetsPrintConfirm ? (
        <Alert
          severity="warning"
          role="alert"
          sx={{ borderRadius: 0 }}
          action={(
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                color="inherit"
                onClick={() => { void printPreview({ skipSheetsConfirm: true }); }}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Печатать показанное
              </Button>
              <Button
                size="small"
                color="inherit"
                onClick={() => setSheetsPrintConfirm(false)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Отмена
              </Button>
            </Stack>
          )}
          onClose={() => setSheetsPrintConfirm(false)}
        >
          Предпросмотр ограничен: в печать попадут только показанные строки.
          Для полной печати откройте документ в редакторе.
        </Alert>
      ) : null}

      {showModeTabs ? (
        <Tabs
          value={resolvedMode}
          onChange={(_event, nextMode) => setMode(nextMode)}
          variant="fullWidth"
          sx={{
            minHeight: 42,
            borderBottom: '1px solid',
            borderColor: 'divider',
            '& .MuiTab-root': { minHeight: 42, textTransform: 'none', fontWeight: 800 },
          }}
        >
          <Tab value="table" label="Таблица" />
          <Tab value="pdf" label="PDF" />
        </Tabs>
      ) : null}

      <DialogContent
        dividers={false}
        sx={{
          p: 0,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: resolvedMode === 'table' ? 'auto' : 'hidden',
          bgcolor: theme.palette.mode === 'dark' ? 'background.default' : '#f8fafc',
          pb: { xs: 'env(safe-area-inset-bottom)', sm: 0 },
        }}
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}
