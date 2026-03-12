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
import { buildMailUiTokens } from './mailUiTokens';

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

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '12px' } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Подпись</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.2} sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Подпись автоматически добавляется в конце каждого отправленного письма.
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
                borderTopLeftRadius: '8px',
                borderTopRightRadius: '8px',
              },
              '& .ql-container': {
                borderColor: tokens.panelBorder,
                borderBottomLeftRadius: '8px',
                borderBottomRightRadius: '8px',
                color: 'text.primary',
                bgcolor: tokens.panelSolid,
                fontFamily: 'inherit',
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

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '10px', bgcolor: tokens.surfaceBg, borderColor: tokens.surfaceBorder, boxShadow: 'none' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Предпросмотр подписи:
            </Typography>
            <Box
              sx={{
                mt: 0.8,
                fontSize: '0.9rem',
                lineHeight: 1.45,
                '& img': { maxWidth: '100%' },
                '& p, & div': { margin: 0 },
                '& p + p, & p + div, & div + p, & div + div': { marginTop: '0.3em' },
                '& ul, & ol': { margin: '0.35em 0 0.35em 1.2em', padding: 0 },
                '& li': { margin: 0 },
              }}
              dangerouslySetInnerHTML={{ __html: signatureHtml || '<span style="color:#999">Подпись не задана</span>' }}
            />
          </Paper>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
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
