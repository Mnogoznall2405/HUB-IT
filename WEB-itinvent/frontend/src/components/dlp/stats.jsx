import React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ComputerIcon from '@mui/icons-material/Computer';
import PublicIcon from '@mui/icons-material/Public';
import UploadFileIcon from '@mui/icons-material/UploadFile';

export function CountCell({ value, color }) {
  const n = Number(value) || 0;
  if (!n) {
    return <Typography component="span" variant="body2" color="text.disabled">—</Typography>;
  }
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-block',
        minWidth: 24,
        px: 0.75,
        py: 0.125,
        borderRadius: 1,
        textAlign: 'center',
        fontWeight: 700,
        fontSize: 13,
        lineHeight: 1.5,
        color: color ? `${color.split('.')[0]}.main` : 'text.primary',
        bgcolor: color
          ? alpha(theme.palette[color.split('.')[0]]?.main || theme.palette.text.primary, 0.14)
          : 'transparent',
      })}
    >
      {n}
    </Box>
  );
}

export function GroupStatChip({ label, count, color }) {
  const n = Number(count) || 0;
  if (!n) return null;
  return (
    <Chip
      size="small"
      variant="outlined"
      color={color}
      label={`${label} ${n}`}
      sx={{ height: 22, '& .MuiChip-label': { px: 0.75 } }}
    />
  );
}

export function MiniStat({ label, value, icon, color = 'primary' }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
      <Box component="span" sx={{ color: `${color}.main`, display: 'inline-flex' }}>{icon}</Box>
      <Typography component="span" sx={{ fontWeight: 700, fontSize: 14 }}>{value}</Typography>
      <Typography component="span" variant="caption" color="text.secondary" noWrap>
        {label}
      </Typography>
    </Stack>
  );
}

export function DlpSummaryInline({ summary }) {
  if (!summary) return null;
  return (
    <Stack
      direction="row"
      alignItems="center"
      useFlexGap
      flexWrap="wrap"
      sx={{ columnGap: 1.75, rowGap: 0.25, minWidth: 0 }}
    >
      <MiniStat
        label="ПК активны"
        value={`${summary.hosts_active_today ?? 0}/${summary.hosts_total ?? 0}`}
        icon={<ComputerIcon sx={{ fontSize: 15 }} />}
        color="primary"
      />
      <MiniStat
        label="визиты сегодня"
        value={summary.visits_today ?? 0}
        icon={<PublicIcon sx={{ fontSize: 15 }} />}
        color="info"
      />
      <MiniStat
        label="файл. события"
        value={summary.file_events_today ?? 0}
        icon={<UploadFileIcon sx={{ fontSize: 15 }} />}
        color="warning"
      />
    </Stack>
  );
}

