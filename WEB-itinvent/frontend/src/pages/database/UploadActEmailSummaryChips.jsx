import { memo } from 'react';
import { Box, Chip } from '@mui/material';

const UploadActEmailSummaryChips = memo(function UploadActEmailSummaryChips({ summary }) {
  const successCount = Number(summary?.successCount || 0);
  const failedCount = Number(summary?.failedCount || 0);

  if (successCount <= 0 && failedCount <= 0) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
      <Chip size="small" color="success" label={`Отправлено: ${successCount}`} />
      <Chip
        size="small"
        color={failedCount > 0 ? 'warning' : 'default'}
        label={`Ошибок: ${failedCount}`}
      />
      <Chip
        size="small"
        variant="outlined"
        label={summary?.mode === 'auto' ? 'Автоотправка' : 'Ручная отправка'}
      />
    </Box>
  );
});

export default UploadActEmailSummaryChips;
