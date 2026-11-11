import { memo } from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';

export const UPLOAD_ACT_STEPS = [
  { step: 1, label: 'Файл' },
  { step: 2, label: 'Проверка' },
  { step: 3, label: 'Запись в базу' },
  { step: 4, label: 'Отправка email' },
];

const UploadActStepChips = memo(function UploadActStepChips({ activeStep, sx }) {
  const normalizedActiveStep = Number(activeStep || 0);

  return (
    <Paper variant="outlined" sx={sx}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Этапы загрузки акта
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {UPLOAD_ACT_STEPS.map((entry) => {
          const active = normalizedActiveStep >= entry.step;
          return (
            <Chip
              key={entry.step}
              size="small"
              label={`${entry.step}. ${entry.label}`}
              color={active ? 'primary' : 'default'}
              variant={active ? 'filled' : 'outlined'}
              sx={{
                transition: 'all 200ms ease',
                transform: active ? 'translateY(0)' : 'translateY(1px)',
              }}
            />
          );
        })}
      </Box>
    </Paper>
  );
});

export default UploadActStepChips;
