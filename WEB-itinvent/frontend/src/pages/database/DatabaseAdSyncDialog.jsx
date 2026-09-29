import { memo } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

const noop = () => {};

const formatDbResult = (stats) => {
  const added = Number(stats?.added || 0);
  const updated = Number(stats?.updated || 0);
  const errors = Number(stats?.errors || 0);
  return `добавлено: ${added}, обновлено: ${updated}, ошибок: ${errors}`;
};

// Confirm + result dialog for the AD -> OWNERS sync. The sync always writes to
// every configured ITINVENT database, not only the currently selected one.
const DatabaseAdSyncDialog = memo(function DatabaseAdSyncDialog({
  open = false,
  running = false,
  result = null,
  error = '',
  databases = [],
  onClose = noop,
  onConfirm = noop,
}) {
  const dbNameById = Object.fromEntries(
    (Array.isArray(databases) ? databases : []).map((db) => [String(db?.id || ''), String(db?.name || db?.id || '')]),
  );
  const resultEntries = result && typeof result === 'object' && result.results && typeof result.results === 'object'
    ? Object.entries(result.results)
    : [];

  return (
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Синхронизация сотрудников из AD</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Загружает активных пользователей Active Directory в таблицу OWNERS
          всех настроенных баз ITINVENT — не только выбранной на странице.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Новые сотрудники добавляются, у существующих обновляются отдел,
          должность, телефон и почта. Удаление не выполняется.
        </Typography>

        {resultEntries.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Alert severity="success" sx={{ mb: 1 }}>
              Синхронизация завершена. В AD найдено пользователей: {Number(result?.total_ad_users || 0)}.
            </Alert>
            {resultEntries.map(([dbId, stats]) => (
              <Typography key={dbId} variant="body2" sx={{ py: 0.25 }}>
                <strong>{dbNameById[dbId] || dbId}</strong>: {formatDbResult(stats)}
              </Typography>
            ))}
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, justifyContent: 'flex-end', gap: 1 }}>
        <Button variant="outlined" onClick={onClose} disabled={running}>
          Закрыть
        </Button>
        {!result && (
          <Button
            variant="contained"
            onClick={onConfirm}
            disabled={running}
            startIcon={running ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {running ? 'Синхронизация...' : 'Запустить синхронизацию'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});

export default DatabaseAdSyncDialog;
