import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
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
import DocumentPreviewDialog, { isDocumentPreviewKind } from '../documentPreview/DocumentPreviewDialog';

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
          <Stack spacing={0.8}>
            <Paper variant="outlined" sx={{ p: 1, borderRadius: '8px', bgcolor: tokens.surfaceBg, borderColor: tokens.surfaceBorder, boxShadow: 'none' }}>
              <Typography variant="caption" color="text.secondary">
                {attachmentPreview.contentType || 'text/plain'}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '8px', maxHeight: '65vh', overflow: 'auto' }}>
              <Box component="pre" sx={{ m: 0, fontFamily: 'var(--mail-mono-font)', fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {attachmentPreview.textContent || '(пустой файл)'}
              </Box>
            </Paper>
            {attachmentPreview.textTruncated ? (
              <Alert severity="info">Показана только часть файла (до 1 МБ).</Alert>
            ) : null}
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
