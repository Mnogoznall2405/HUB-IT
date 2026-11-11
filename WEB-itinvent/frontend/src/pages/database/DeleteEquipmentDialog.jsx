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
  blocked = null,
  canDeleteWithHistory = false,
  onClose,
  onConfirm,
  onConfirmWithHistory,
}) {
  const item = target?.item || null;
  const blockedParts = blocked
    ? [
      blocked.acts > 0 ? `актов: ${blocked.acts}` : '',
      blocked.history > 0 ? `записей истории: ${blocked.history}` : '',
    ].filter(Boolean).join(', ')
    : '';

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
        {blocked && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            У карточки есть связанные данные ({blockedParts}).{' '}
            {canDeleteWithHistory
              ? 'Можно удалить карточку вместе с ними — акты и история пропадут безвозвратно.'
              : 'Удалить её нельзя: у вас нет права удалять оборудование вместе с историей.'}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Отмена
        </Button>
        {blocked ? (
          canDeleteWithHistory && (
            <Button
              color="error"
              variant="contained"
              onClick={onConfirmWithHistory}
              disabled={loading}
            >
              {loading ? 'Удаление...' : 'Удалить вместе с историей'}
            </Button>
          )
        ) : (
          <Button
            color="error"
            variant="contained"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Удаление...' : 'Удалить'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default DeleteEquipmentDialog;
