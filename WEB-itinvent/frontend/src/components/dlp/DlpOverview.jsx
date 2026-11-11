import React, { useMemo } from 'react';
import {
  Box,
  ButtonBase,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { formatDwell, shortLabel } from './utils';

function num(row, key) {
  return Number(row?.[key]) || 0;
}

function KpiCard({ title, value, caption, color = 'text.primary' }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
    >
      <Typography variant="caption" color="text.secondary" noWrap>
        {title}
      </Typography>
      <Typography
        variant="h6"
        sx={{ color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}
        noWrap
      >
        {value}
      </Typography>
      {caption ? (
        <Typography variant="caption" color="text.secondary" noWrap>
          {caption}
        </Typography>
      ) : null}
    </Paper>
  );
}

function AttentionList({ title, rows, metric, onOpenHost }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {rows.length ? (
        <Stack spacing={0.25}>
          {rows.map((row) => (
            <ButtonBase
              key={row.computer_name}
              onClick={() => onOpenHost(row.computer_name)}
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 1,
                px: 0.5,
                py: 0.25,
                borderRadius: 0.5,
                textAlign: 'left',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {row.user_full_name || row.computer_name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {shortLabel(
                    [row.computer_name, row.branch_name].filter(Boolean).join(' · '),
                    44,
                  )}
                </Typography>
              </Box>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
              >
                {metric(row)}
              </Typography>
            </ButtonBase>
          ))}
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          Нет данных за день
        </Typography>
      )}
    </Paper>
  );
}

export default function DlpOverview({ day, onDayChange, attention, loading, onOpenHost }) {
  const hosts = useMemo(() => (Array.isArray(attention) ? attention : []), [attention]);

  const kpi = useMemo(() => {
    const worked = hosts.filter((h) => num(h, 'active_sec') > 0 || num(h, 'passive_sec') > 0);
    const active = hosts.reduce((s, h) => s + num(h, 'active_sec'), 0);
    return {
      activeHosts: worked.length,
      active,
      avgActive: worked.length ? active / worked.length : 0,
      away: hosts.reduce((s, h) => s + num(h, 'away_sec'), 0),
      entertainment: hosts.reduce((s, h) => s + num(h, 'entertainment_sec'), 0),
      usbFiles: hosts.reduce((s, h) => s + num(h, 'usb_files'), 0),
      usbBytes: hosts.reduce((s, h) => s + num(h, 'usb_bytes'), 0),
      messengerFiles: hosts.reduce((s, h) => s + num(h, 'messenger_files'), 0),
    };
  }, [hosts]);

  const tops = useMemo(() => {
    const idleOf = (h) => (num(h, 'away_sec') > 0 ? num(h, 'away_sec') : num(h, 'browser_idle_sec'));
    const top5 = (key, getter = (h) => num(h, key)) =>
      [...hosts]
        .filter((h) => getter(h) > 0)
        .sort((a, b) => getter(b) - getter(a))
        .slice(0, 5);
    return {
      entertainment: top5('entertainment_sec'),
      idle: top5('idle', idleOf),
      usb: top5('usb_files'),
      messenger: top5('messenger_files'),
    };
  }, [hosts]);

  return (
    <Stack spacing={1.5} sx={{ flexShrink: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle1" fontWeight={700}>
          Сводка за день
        </Typography>
        <TextField
          size="small"
          type="date"
          value={day}
          onChange={(e) => onDayChange(e.target.value)}
          inputProps={{ 'aria-label': 'День сводки' }}
          sx={{ width: 160 }}
        />
      </Stack>
      {loading ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(6,1fr)' }, gap: 1 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={72} />
          ))}
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(6,1fr)' }, gap: 1 }}>
          <KpiCard title="Активных ПК" value={kpi.activeHosts} />
          <KpiCard
            title="Работали"
            value={formatDwell(kpi.active)}
            caption={kpi.activeHosts ? `≈ ${formatDwell(kpi.avgActive)} на ПК` : undefined}
            color="success.main"
          />
          <KpiCard title="Отошли" value={formatDwell(kpi.away)} color="warning.main" />
          <KpiCard title="Развлечения" value={formatDwell(kpi.entertainment)} color="warning.main" />
          <KpiCard title="USB-файлов" value={kpi.usbFiles} color="info.main" />
          <KpiCard title="Файлов в мессенджеры" value={kpi.messengerFiles} color="info.main" />
        </Box>
      )}
      <Typography variant="subtitle1" fontWeight={700}>
        Обратить внимание
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)', xl: 'repeat(4,1fr)' },
          gap: 1,
        }}
      >
        <AttentionList
          title="Развлечения"
          rows={tops.entertainment}
          metric={(h) => formatDwell(num(h, 'entertainment_sec'))}
          onOpenHost={onOpenHost}
        />
        <AttentionList
          title="Простой"
          rows={tops.idle}
          metric={(h) => formatDwell(num(h, 'away_sec') > 0 ? num(h, 'away_sec') : num(h, 'browser_idle_sec'))}
          onOpenHost={onOpenHost}
        />
        <AttentionList
          title="USB"
          rows={tops.usb}
          metric={(h) => `${num(h, 'usb_files')} шт`}
          onOpenHost={onOpenHost}
        />
        <AttentionList
          title="Мессенджеры"
          rows={tops.messenger}
          metric={(h) => `${num(h, 'messenger_files')} шт`}
          onOpenHost={onOpenHost}
        />
      </Box>
    </Stack>
  );
}
