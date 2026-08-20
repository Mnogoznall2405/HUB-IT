import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  buildMailUiTokens,
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
} from './mailUiTokens';
import { MAIL_AI_DISCLOSURE_TEXT } from './mailAiFlags';

export default function MailAiConsentDialog({
  open = false,
  onClose,
  onConfirm,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: getMailDialogPaperSx(tokens) }}
    >
      <DialogTitle sx={getMailDialogTitleSx(tokens)}>ИИ для писем</DialogTitle>
      <DialogContent dividers sx={getMailDialogContentSx(tokens)}>
        <Alert severity="info" data-testid="mail-ai-disclosure" sx={{ borderRadius: '10px' }}>
          {MAIL_AI_DISCLOSURE_TEXT}
        </Alert>
      </DialogContent>
      <DialogActions sx={getMailDialogActionsSx(tokens)}>
        <Button onClick={onClose} data-testid="mail-ai-consent-cancel">
          Отмена
        </Button>
        <Button variant="contained" onClick={onConfirm} data-testid="mail-ai-consent-confirm">
          Разрешить ИИ
        </Button>
      </DialogActions>
    </Dialog>
  );
}
