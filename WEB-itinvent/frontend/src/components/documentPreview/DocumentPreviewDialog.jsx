import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
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
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';

const MailPdfPreviewSurface = lazy(() => import('../mail/MailPdfPreviewSurface'));
const MailExcelPreviewGrid = lazy(() => import('../mail/MailExcelPreviewGrid'));

const DOCUMENT_PREVIEW_KINDS = new Set(['pdf', 'office_pdf', 'office_excel']);

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
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isExcel = sourceKind === 'excel' || kind === 'office_excel';
  const hasExcelTable = Boolean(isExcel && excelWorkbook);
  const hasPdfPreview = Boolean(objectUrl && (kind === 'pdf' || kind === 'office_pdf' || isExcel));
  const preferredMode = hasExcelTable ? 'table' : 'pdf';
  const [mode, setMode] = useState(preferredMode);

  useEffect(() => {
    if (open) setMode(preferredMode);
  }, [open, preferredMode]);

  const showModeTabs = hasExcelTable && hasPdfPreview;
  const resolvedMode = hasExcelTable && mode === 'table' ? 'table' : 'pdf';
  const heading = title || 'Документ';
  const subheading = subtitle || (isExcel ? 'Excel' : kind === 'office_pdf' ? 'PDF-предпросмотр' : 'PDF');

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
        <Box sx={{ minHeight: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
    hasPdfPreview,
    heading,
    isMobile,
    loading,
    onRefresh,
    pageCount,
    resolvedMode,
    sheets,
    sourceKind,
    objectUrl,
  ]);

  return (
    <Dialog
      open={Boolean(open)}
      onClose={onClose}
      fullScreen
      maxWidth={false}
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
          pt: { xs: 'calc(env(safe-area-inset-top) + 8px)', sm: 1.25 },
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
            {onRefresh ? (
              <Tooltip title="Обновить">
                <span>
                  <IconButton onClick={onRefresh} disabled={loading} aria-label="Обновить">
                    {loading ? <CircularProgress size={20} /> : <RefreshRoundedIcon />}
                  </IconButton>
                </span>
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
