import {
  Alert,
  Button,
  IconButton,
  Snackbar,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

export default function EquipmentQrPrintFeedback({
  feedback,
  onClose,
  onRepeat,
  repeating = false,
}) {
  return (
    <Snackbar
      open={Boolean(feedback)}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert
        severity={feedback?.severity || 'info'}
        role="status"
        aria-live="polite"
        action={feedback ? (
          <>
            {feedback.canRepeat ? (
              <Button
                color="inherit"
                size="small"
                onClick={onRepeat}
                disabled={repeating}
              >
                Повторить печать
              </Button>
            ) : null}
            <IconButton
              color="inherit"
              size="small"
              onClick={onClose}
              aria-label="Закрыть уведомление о печати"
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </>
        ) : null}
        sx={{ alignItems: 'center' }}
      >
        {feedback?.message || ''}
      </Alert>
    </Snackbar>
  );
}
