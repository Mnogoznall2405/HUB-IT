import { memo } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';

const UploadActReminderPanel = memo(function UploadActReminderPanel({
  binding,
  loading = false,
  error = '',
  onOpenTask,
  onRefreshReminder,
}) {
  if (!binding && !loading && !error) {
    return null;
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Reminder по загрузке акта
      </Typography>
      {loading && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Загрузка данных напоминания...
        </Typography>
      )}
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {binding && (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="body2">
            Ожидается актов: {Number(binding.pending_groups_total || 0)}. Загружено:{' '}
            {Number(binding.completed_groups_total || 0)}.
          </Typography>
          {Array.isArray(binding.pending_groups) && binding.pending_groups.length > 0 && (
            <Box sx={{ display: 'grid', gap: 0.5 }}>
              {binding.pending_groups.slice(0, 4).map((group) => (
                <Typography
                  key={String(group.id || group.generated_act_id || group.old_employee_name)}
                  variant="caption"
                  color="text.secondary"
                >
                  {group.old_employee_name || 'Без владельца'}:{' '}
                  {Array.isArray(group.inv_nos) ? group.inv_nos.join(', ') : '-'}
                </Typography>
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {binding.task_id && (
              <Button size="small" variant="outlined" onClick={() => onOpenTask?.(binding.task_id)}>
                Открыть задачу
              </Button>
            )}
            {binding.reminder_id && (
              <Button size="small" variant="text" onClick={() => onRefreshReminder?.(binding.reminder_id)}>
                Обновить статус
              </Button>
            )}
          </Box>
        </Box>
      )}
    </Paper>
  );
});

export default UploadActReminderPanel;
