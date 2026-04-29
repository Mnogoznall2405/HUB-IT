import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import {
  buildMailUiTokens,
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
  getMailMetaTextSx,
} from './mailUiTokens';
import { buildSignaturePreviewHtml } from './mailOutgoingPreview';

export default function MailSignatureDialog({
  open,
  onClose,
  signatureHtml,
  onSignatureChange,
  signatureSaving,
  onClear,
  onSave,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const signaturePreviewHtml = useMemo(
    () => buildSignaturePreviewHtml(signatureHtml),
    [signatureHtml],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: getMailDialogPaperSx(tokens) }}>
      <DialogTitle sx={getMailDialogTitleSx(tokens)}>Подпись</DialogTitle>
      <DialogContent dividers sx={getMailDialogContentSx(tokens)}>
        <Stack spacing={1.2} sx={{ mt: 0.5 }}>
          <Typography sx={getMailMetaTextSx(tokens)}>
            Подпись отправляется без зависимости от темы интерфейса. В ответах и пересылках она ставится перед историей переписки.
          </Typography>
          <Box
            sx={{
              flex: 1,
              minHeight: 260,
              display: 'flex',
              flexDirection: 'column',
              '& .ql-toolbar': {
                borderColor: tokens.panelBorder,
                bgcolor: tokens.surfaceBg,
                borderTopLeftRadius: tokens.radiusSm,
                borderTopRightRadius: tokens.radiusSm,
              },
              '& .ql-container': {
                borderColor: tokens.panelBorder,
                borderBottomLeftRadius: tokens.radiusSm,
                borderBottomRightRadius: tokens.radiusSm,
                color: 'text.primary',
                bgcolor: tokens.panelSolid,
                fontFamily: 'var(--mail-message-font)',
                fontSize: '0.95rem',
              },
              '& .ql-editor': { minHeight: '220px' },
            }}
          >
            <ReactQuill
              theme="snow"
              value={signatureHtml}
              onChange={onSignatureChange}
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            />
          </Box>

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: tokens.radiusLg, bgcolor: tokens.surfaceBg, borderColor: tokens.surfaceBorder, boxShadow: 'none' }}>
            <Typography sx={getMailMetaTextSx(tokens, { fontWeight: 700 })}>
              Как это будет выглядеть в письме:
            </Typography>
            <Box
              data-testid="mail-signature-final-preview"
              sx={{
                mt: 0.8,
                fontSize: '0.9rem',
                lineHeight: 1.45,
                fontFamily: 'var(--mail-message-font)',
                borderRadius: tokens.radiusSm,
                border: '1px solid',
                borderColor: tokens.surfaceBorder,
                bgcolor: 'transparent',
                color: tokens.textPrimary,
                px: 1.6,
                py: 1.35,
                '& img': { maxWidth: '100%' },
                '& p, & div': { margin: 0 },
                '& p + p, & p + div, & div + p, & div + div': { marginTop: '0.4em' },
                '& ul, & ol': { margin: '0.35em 0 0.35em 1.2em', padding: 0 },
                '& li': { margin: 0 },
                '& blockquote': {
                  margin: '0.8em 0 0',
                  padding: '0 0 0 12px',
                  borderLeft: '3px solid',
                  borderColor: tokens.surfaceBorder,
                  color: tokens.textSecondary,
                },
              }}
              dangerouslySetInnerHTML={{ __html: signaturePreviewHtml }}
            />
          </Paper>
        </Stack>
      </DialogContent>

      <DialogActions sx={getMailDialogActionsSx(tokens)}>
        <Button onClick={onClear} disabled={signatureSaving} sx={{ textTransform: 'none' }}>
          Очистить
        </Button>
        <Button onClick={onClose} disabled={signatureSaving} sx={{ textTransform: 'none' }}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={signatureSaving}
          sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}
        >
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
