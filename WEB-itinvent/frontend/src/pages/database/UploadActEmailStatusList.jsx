import { memo } from 'react';
import { Box, Chip, Collapse, Fade, Paper, Typography } from '@mui/material';

export const getUploadActEmailStatusMeta = (statusInput) => {
  const status = String(statusInput || '').trim();
  if (status === 'sent') {
    return { color: 'success', label: 'Отправлено' };
  }
  if (status === 'missing_email') {
    return { color: 'warning', label: 'Нет email' };
  }
  if (status === 'not_found') {
    return { color: 'warning', label: 'Не найден' };
  }
  return { color: 'error', label: 'Ошибка' };
};

const defaultGetItemSx = (overrides) => overrides;

const UploadActEmailStatusList = memo(function UploadActEmailStatusList({
  recipients,
  getItemSx = defaultGetItemSx,
}) {
  const rows = Array.isArray(recipients) ? recipients : [];

  return (
    <Collapse in={rows.length > 0}>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
          Статусы отправки
        </Typography>
        <Box sx={{ display: 'grid', gap: 1 }}>
          {rows.map((recipient, idx) => {
            const meta = getUploadActEmailStatusMeta(recipient?.status);
            return (
              <Fade
                in
                timeout={180 + (idx * 70)}
                key={`${String(recipient?.owner_no || recipient?.employee_name || 'recipient')}-${idx}`}
              >
                <Box
                  sx={getItemSx({
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    p: 1,
                    borderRadius: 1,
                  })}
                >
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {recipient?.employee_name || 'Неизвестный сотрудник'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {recipient?.email || recipient?.detail || '-'}
                    </Typography>
                  </Box>
                  <Chip size="small" color={meta.color} label={meta.label} />
                </Box>
              </Fade>
            );
          })}
        </Box>
      </Paper>
    </Collapse>
  );
});

export default UploadActEmailStatusList;
