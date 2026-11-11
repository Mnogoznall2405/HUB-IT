import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { HISTORY_FIELD_LABELS, formatMovementDate } from './employeeCompareFormat';

export function EquipmentHistoryDialog({ open, invNo, rows, loading, error, onClose, fullScreen = false }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle sx={{ pr: 6 }}>
        История передач — {invNo}
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Загрузка истории...</Typography>
          </Stack>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!loading && !error && !(Array.isArray(rows) && rows.length) ? (
          <Typography variant="body2" color="text.secondary">
            Записей истории по этой позиции нет.
          </Typography>
        ) : null}
        {!loading && !error && Array.isArray(rows) && rows.length ? (
          <List dense disablePadding>
            {rows.map((row, index) => {
              const changes = HISTORY_FIELD_LABELS
                .filter(([oldKey, newKey]) => String(row?.[oldKey] || '') !== String(row?.[newKey] || ''))
                .map(([oldKey, newKey, label]) => `${label}: ${row?.[oldKey] || '—'} → ${row?.[newKey] || '—'}`);
              return (
                <Box
                  key={row?.hist_id ?? index}
                  sx={{ py: 0.9, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {formatMovementDate(row?.ch_date) || '—'}
                    {row?.ch_user ? ` · ${row.ch_user}` : ''}
                  </Typography>
                  {changes.length ? changes.map((line) => (
                    <Typography key={line} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {line}
                    </Typography>
                  )) : (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Изменение без различий в ключевых полях
                    </Typography>
                  )}
                  {row?.ch_comment ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {row.ch_comment}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </List>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

export default EquipmentHistoryDialog;
