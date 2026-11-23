import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { lazy, Suspense, useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import {
  buildMailUiTokens,
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
} from './mailUiTokens';
import { getMailAttachmentVisual } from './mailAttachmentVisuals';
import { getTextFileKind, getTextLanguage } from '../../lib/textPreview';
import DocumentPreviewDialog, { isDocumentPreviewKind } from '../documentPreview/DocumentPreviewDialog';

const CodeMirrorTextViewer = lazy(() => import('../documentPreview/CodeMirrorTextViewer'));
const MarkdownFileViewer = lazy(() => import('../documentPreview/MarkdownFileViewer'));
const CsvPreviewPanel = lazy(() => import('../documentPreview/CsvPreviewPanel'));

const viewerFallback = (
  <Skeleton variant="rectangular" height={360} sx={{ borderRadius: '8px' }} />
);

export default function MailAttachmentPreviewDialog({
  attachmentPreview,
  onClose,
  onDownload,
  onDownloadPreviewPdf,
  formatFileSize,
  maxPreviewFileBytes,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const attachmentVisual = useMemo(
    () => getMailAttachmentVisual({ name: attachmentPreview.filename, content_type: attachmentPreview.contentType }),
    [attachmentPreview.contentType, attachmentPreview.filename],
  );
  const AttachmentIcon = attachmentVisual.Icon;
  const isDocumentPreview = isDocumentPreviewKind(attachmentPreview.kind);

  if (isDocumentPreview) {
    return (
      <DocumentPreviewDialog
        open={attachmentPreview.open}
        title={attachmentPreview.filename || 'вложение'}
        subtitle={attachmentPreview.sourceKind === 'excel' ? 'Excel' : attachmentVisual.label}
        kind={attachmentPreview.kind}
        sourceKind={attachmentPreview.sourceKind}
        objectUrl={attachmentPreview.objectUrl}
        excelWorkbook={attachmentPreview.excelWorkbook}
        officeView={attachmentPreview.officeView}
        pageCount={attachmentPreview.pageCount}
        sheets={attachmentPreview.sheets}
        loading={attachmentPreview.loading}
        error={attachmentPreview.error}
        onClose={onClose}
        onDownloadOriginal={onDownload}
        onDownloadPdf={onDownloadPreviewPdf}
        canDownloadOriginal={Boolean(attachmentPreview.blob || attachmentPreview.downloadContext)}
        canDownloadPdf={Boolean(attachmentPreview.previewBlob)}
      />
    );
  }

  return (
    <Dialog
      open={attachmentPreview.open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: getMailDialogPaperSx(tokens) }}
    >
      <DialogTitle sx={getMailDialogTitleSx(tokens, { fontWeight: 700 })}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <AttachmentIcon sx={{ color: attachmentVisual.color }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="inherit" noWrap sx={{ fontWeight: 700 }}>
              {attachmentPreview.filename || 'вложение'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {attachmentVisual.label}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent
        dividers
        sx={getMailDialogContentSx(tokens, {
          minHeight: { xs: 0, sm: 420 },
          px: { xs: 1, sm: 2 },
          py: { xs: 1, sm: 1.5 },
        })}
      >
        {attachmentPreview.loading ? (
          <Stack spacing={1}>
            <Skeleton variant="text" width="35%" />
            <Skeleton variant="rectangular" height={360} sx={{ borderRadius: '8px' }} />
          </Stack>
        ) : attachmentPreview.error ? (
          <Alert severity="error">{attachmentPreview.error}</Alert>
        ) : attachmentPreview.kind === 'image' && attachmentPreview.objectUrl ? (
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Box
              component="img"
              src={attachmentPreview.objectUrl}
              alt={attachmentPreview.filename || 'предпросмотр'}
              sx={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '8px' }}
            />
          </Box>
        ) : attachmentPreview.kind === 'pdf' && attachmentPreview.objectUrl ? (
          null
        ) : attachmentPreview.kind === 'text' ? (
          <Stack spacing={0.8} sx={{ minHeight: 0, height: '100%' }}>
            {(() => {
              const nativeKind = getTextFileKind({
                fileName: attachmentPreview.filename,
                contentType: attachmentPreview.contentType,
              });
              return (
                <Suspense fallback={viewerFallback}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '65vh', border: '1px solid', borderColor: tokens.surfaceBorder, borderRadius: '8px', overflow: 'hidden' }}>
                    {nativeKind === 'markdown' ? (
                      <MarkdownFileViewer
                        value={attachmentPreview.textContent || ''}
                        fileName={attachmentPreview.filename}
                        truncated={attachmentPreview.textTruncated}
                      />
                    ) : nativeKind === 'csv' ? (
                      <CsvPreviewPanel blob={attachmentPreview.blob} />
                    ) : (
                      <CodeMirrorTextViewer
                        value={attachmentPreview.textContent || ''}
                        fileName={attachmentPreview.filename}
                        language={getTextLanguage(attachmentPreview.filename)}
                        truncated={attachmentPreview.textTruncated}
                      />
                    )}
                  </Box>
                </Suspense>
              );
            })()}
          </Stack>
        ) : attachmentPreview.kind === 'unsupported' ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            Предпросмотр недоступен для этого типа файла. Используйте кнопку «Скачать», чтобы сохранить файл и открыть его в соответствующей программе.
          </Alert>
        ) : attachmentPreview.tooLargeForPreview ? (
          <Alert severity="warning">
            {`Файл слишком большой для предпросмотра (> ${formatFileSize(maxPreviewFileBytes)}). Используйте кнопку «Скачать».`}
          </Alert>
        ) : (
          <Alert severity="info">
            Предпросмотр недоступен для этого типа файла. Используйте кнопку «Скачать».
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={getMailDialogActionsSx(tokens, {
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        px: { xs: 1, sm: 2 },
        py: { xs: 1, sm: 1.15 },
        '& .MuiButton-root': { minHeight: 40 },
        [theme.breakpoints.down('sm')]: {
          '& .MuiButton-root': { flex: '1 1 auto', minWidth: 0 },
        },
      })}
      >
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Закрыть
        </Button>
        <Button
          variant="contained"
          startIcon={<DownloadIcon />}
          onClick={onDownload}
          disabled={attachmentPreview.loading || (!attachmentPreview.blob && !attachmentPreview.downloadContext)}
          sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}
        >
          Скачать
        </Button>
      </DialogActions>
    </Dialog>
  );
}
