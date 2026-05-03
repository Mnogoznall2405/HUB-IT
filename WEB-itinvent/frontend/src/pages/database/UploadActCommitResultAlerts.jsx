import { memo } from 'react';
import { Alert } from '@mui/material';

const UploadActCommitResultAlerts = memo(function UploadActCommitResultAlerts({ result }) {
  if (!result) return null;

  const reminderStatus = String(result?.reminder_status || '').trim();
  const reminderWarning = String(result?.reminder_warning || '').trim();

  return (
    <>
      <Alert severity="success" variant="outlined">
        Акт сохранён в базе: DOC_NO {result?.doc_no}, FILE_NO {result?.file_no}.
      </Alert>

      {reminderStatus === 'matched_partial' && (
        <Alert severity="info">
          Акт привязан к reminder-задаче. Осталось загрузить актов:{' '}
          {Number(result?.reminder_pending_groups || 0)}.
        </Alert>
      )}
      {reminderStatus === 'completed' && (
        <Alert severity="success">
          Все подписанные акты загружены. Reminder-задача закрыта автоматически.
        </Alert>
      )}
      {reminderWarning && (
        <Alert severity="warning">{reminderWarning}</Alert>
      )}
    </>
  );
});

export default UploadActCommitResultAlerts;
