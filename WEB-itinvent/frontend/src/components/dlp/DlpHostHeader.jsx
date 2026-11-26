import React from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { formatAgo } from './utils';

export default function DlpHostHeader({ host, stats, day, onDayChange, onBack, onOpenReport, reportBusy = false }) {
  const meta = [
    stats?.user_login,
    stats?.branch_name,
    stats?.last_ts ? `был в сети ${formatAgo(stats.last_ts)}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      flexWrap="wrap"
      gap={1}
      sx={{ flexShrink: 0 }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: '1 1 auto' }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={onBack}
          sx={{ flexShrink: 0 }}
        >
          К списку хостов
        </Button>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" noWrap>{host}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {[stats?.user_full_name, meta].filter(Boolean).join(' · ') || '—'}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          type="date"
          value={day}
          onChange={(e) => onDayChange(e.target.value)}
          inputProps={{ 'aria-label': 'День по местному времени филиала' }}
          sx={{ width: 150 }}
        />
        <Button size="small" variant="outlined" onClick={onOpenReport} disabled={reportBusy}>
          Актуальный отчёт
        </Button>
      </Stack>
    </Stack>
  );
}
