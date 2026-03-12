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
import { buildMailUiTokens } from './mailUiTokens';

export default function MailAttachmentPreviewDialog({
  attachmentPreview,
  onClose,
  onDownload,
  formatFileSize,
  maxPreviewFileBytes,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  return (
    <Dialog
      open={attachmentPreview.open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { borderRadius: '12px' } }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>
        {`Предпросмотр: ${attachmentPreview.filename || 'вложение'}`}
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 420 }}>
        {attachmentPreview.loading ? (
          <Stack spacing={1}>
            <Skeleton variant="text" width="35%" />
            <Skeleton variant="rectangular" height={320} sx={{ borderRadius: '8px' }} />
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
          <Box
            component="iframe"
            title={attachmentPreview.filename || 'предпросмотр PDF'}
            src={attachmentPreview.objectUrl}
            sx={{ width: '100%', height: '70vh', border: 'none', borderRadius: '8px' }}
          />
        ) : attachmentPreview.kind === 'text' ? (
          <Stack spacing={0.8}>
            <Paper variant="outlined" sx={{ p: 1, borderRadius: '8px', bgcolor: tokens.surfaceBg, borderColor: tokens.surfaceBorder, boxShadow: 'none' }}>
              <Typography variant="caption" color="text.secondary">
                {attachmentPreview.contentType || 'text/plain'}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '8px', maxHeight: '65vh', overflow: 'auto' }}>
              <Box component="pre" sx={{ m: 0, fontFamily: 'Consolas, "Courier New", monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {attachmentPreview.textContent || '(пустой файл)'}
              </Box>
            </Paper>
            {attachmentPreview.textTruncated ? (
              <Alert severity="info">Показана только часть файла (до 1 МБ).</Alert>
            ) : null}
          </Stack>
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
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Закрыть
        </Button>
        <Button
          variant="contained"
          startIcon={<DownloadIcon />}
          onClick={onDownload}
          disabled={attachmentPreview.loading || !attachmentPreview.blob}
          sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}
        >
          Скачать
        </Button>
      </DialogActions>
    </Dialog>
  );
}
