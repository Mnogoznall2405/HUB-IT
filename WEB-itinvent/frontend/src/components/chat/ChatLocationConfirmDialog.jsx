import { useCallback, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

const formatCoordinate = (value) => (
  Number.isFinite(Number(value)) ? Number(value).toFixed(6) : '—'
);

const formatAccuracy = (value) => (
  Number.isFinite(Number(value)) ? `±${Math.round(Number(value))} м` : '—'
);

/** R13: location is sent only after the user confirms the resolved position. */
export default function ChatLocationConfirmDialog({
  open,
  locationDraft,
  onClose,
  onSend,
  dialogPaperSx,
  dialogTitleSx,
  dialogContentSx,
  dialogActionsSx,
}) {
  const [sending, setSending] = useState(false);

  const handleClose = useCallback(() => {
    if (sending) return;
    onClose?.();
  }, [onClose, sending]);

  const handleSend = useCallback(async () => {
    if (sending) return;
    setSending(true);
    try {
      await onSend?.();
    } finally {
      setSending(false);
    }
  }, [onSend, sending]);

  return (
    <Dialog
      open={Boolean(open)}
      onClose={handleClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{ sx: dialogPaperSx }}
      aria-labelledby="chat-location-confirm-title"
    >
      <DialogTitle id="chat-location-confirm-title" sx={dialogTitleSx}>
        Отправить мою геопозицию?
      </DialogTitle>
      <DialogContent sx={dialogContentSx}>
        <DialogContentText>
          Координаты: {formatCoordinate(locationDraft?.latitude)}, {formatCoordinate(locationDraft?.longitude)}
        </DialogContentText>
        <DialogContentText sx={{ mt: 0.5 }}>
          Точность: {formatAccuracy(locationDraft?.accuracy)}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={dialogActionsSx}>
        <Button onClick={handleClose} disabled={sending}>Отмена</Button>
        <Button
          variant="contained"
          onClick={() => void handleSend()}
          disabled={sending}
          data-testid="chat-location-confirm-send"
        >
          {sending ? 'Отправка…' : 'Отправить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
