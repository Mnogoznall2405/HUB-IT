import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

import { readFirst } from './databaseRecordModel';

function DeleteConsumableDialog({
  target,
  error = '',
  loading = false,
  onClose,
  onConfirm,
}) {
  const item = target?.item || null;
  const modelName = readFirst(item, ['MODEL_NAME', 'model_name'], '');

  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>Удалить расходник</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2">
          Удалить расходник{' '}
          <strong>{target?.invNo || '-'}</strong>
          {modelName ? ` (${modelName})` : ''}?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Действие необратимо.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Отмена
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? 'Удаление...' : 'Удалить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DeleteConsumableDialog;
