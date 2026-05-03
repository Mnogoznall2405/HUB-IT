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

function DeleteEquipmentDialog({
  target,
  error = '',
  loading = false,
  onClose,
  onConfirm,
}) {
  const item = target?.item || null;

  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>Удалить оборудование</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2">
          Удалить карточку оборудования{' '}
          <strong>{target?.invNo || '-'}</strong>
          {item
            ? ` (${readFirst(item, ['MODEL_NAME', 'model_name'], 'без модели')})`
            : ''}
          ?
        </Typography>
        {item && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Сотрудник: {readFirst(item, ['OWNER_DISPLAY_NAME', 'employee_name'], '-')}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Это действие необратимо.
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

export default DeleteEquipmentDialog;
