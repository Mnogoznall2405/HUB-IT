import {
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  buildMailUiTokens,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
} from './mailUiTokens';

export default function MailHeadersDialog({ open, onClose, headers }) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" PaperProps={{ sx: getMailDialogPaperSx(tokens) }}>
      <DialogTitle sx={getMailDialogTitleSx(tokens)}>Заголовки письма</DialogTitle>
      <DialogContent dividers sx={getMailDialogContentSx(tokens)}>
        <Stack spacing={0.8}>
          {(headers?.items || []).map((item, index) => (
            <Stack key={`${item?.name || 'header'}_${index}`} spacing={0.2}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {item?.name || '-'}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'var(--mail-mono-font)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {item?.value || '-'}
              </Typography>
            </Stack>
          ))}
          {(!headers?.items || headers.items.length === 0) ? (
            <Typography variant="body2" color="text.secondary">Заголовки недоступны.</Typography>
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
