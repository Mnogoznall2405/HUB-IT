import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Chip, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { fsEgressAPI } from '../../api/fsEgress';
import { formatDwell } from './utils';
import DlpDayTimeline from './DlpDayTimeline';

function clockOfEpoch(ts) {
  if (!ts) return '—';
  return new Date(Number(ts) * 1000).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stripExe(name) {
  return String(name || '').replace(/\.exe$/i, '');
}

/**
 * "День" block for the host card: work window, state totals, activity %,
 * top programs and the 5-minute timeline strip (agent 1.4.19+).
 */
export default function DlpActivityBlock({ computerName, day }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!computerName) {
      setData(null);
      return undefined;
    }
    setLoading(true);
    setError('');
    fsEgressAPI
      .getDlpActivity(computerName, day)
      .then((res) => {
        if (!cancelled) setData(res.data || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setError(err?.response?.data?.detail || err.message || 'Ошибка загрузки активности');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [computerName, day]);

  const summary = data?.summary || {};
  const buckets = useMemo(
    () => (Array.isArray(data?.buckets) ? data.buckets : []),
    [data],
  );
  const appsTop = useMemo(
    () => (Array.isArray(data?.apps_top) ? data.apps_top.slice(0, 5) : []),
    [data],
  );

  return (
    <Paper variant="outlined" sx={{ p: 1.5, flexShrink: 0 }}>
      {loading ? (
        <Stack spacing={1}>
          <Skeleton variant="text" width="45%" />
          <Skeleton variant="rounded" height={26} />
        </Stack>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : !buckets.length ? (
        <Typography variant="body2" color="text.secondary">
          Нет данных об активности — нужен агент 1.4.19
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={2.5}
            alignItems="baseline"
            flexWrap="wrap"
            useFlexGap
            sx={{ rowGap: 0.5 }}
          >
            <Typography variant="subtitle2" sx={{ mr: 0.5 }}>
              День {summary.first_ts ? `${clockOfEpoch(summary.first_ts)}–${clockOfEpoch(summary.last_ts)}` : ''}
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              Работал <b>{formatDwell(summary.active_sec)}</b>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              Пассивно <b>{formatDwell(summary.passive_sec)}</b>
            </Typography>
            <Typography variant="body2" color="warning.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              Отошёл <b>{formatDwell(summary.away_sec)}</b>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              Заблокирован <b>{formatDwell(summary.locked_sec)}</b>
            </Typography>
            {summary.activity_pct != null ? (
              <Typography variant="body2" color="success.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                Активность <b>{summary.activity_pct}%</b>
              </Typography>
            ) : null}
          </Stack>
          <DlpDayTimeline buckets={buckets} day={day} />
          {appsTop.length ? (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {appsTop.map((row) => (
                <Chip
                  key={row.app}
                  size="small"
                  variant="outlined"
                  label={`${stripExe(row.app)} · ${formatDwell(row.sec)}`}
                />
              ))}
            </Stack>
          ) : null}
        </Stack>
      )}
    </Paper>
  );
}
