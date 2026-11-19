import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Chip, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { fsEgressAPI } from '../../api/fsEgress';
import {
  clockAtUtcOffset,
  dayAtUtcOffset,
  displayAppName,
  formatDwell,
  utcOffsetLabel,
} from './utils';
import DlpDayTimeline from './DlpDayTimeline';

const TYUMEN_OFFSET_MIN = 300;

function clockOfEpoch(ts, offsetMinutes) {
  if (!ts) return '—';
  return clockAtUtcOffset(Number(ts) * 1000, offsetMinutes);
}

function hhmm(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return '--:--';
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/**
 * "День" block for the host card: work window, state totals, activity %,
 * top programs and the 5-minute timeline strip (agent 1.4.19+).
 *
 * All times are branch-local from the server's local_time metadata — never
 * the viewer's own timezone.
 */
export default function DlpActivityBlock({ computerName, day, onDayResolved, onOpenBrowser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  // "сейчас" clock/marker refresh — once a minute, only while mounted.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

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
        if (cancelled) return;
        setData(res.data || null);
        onDayResolved?.(res.data?.local_time?.day || '');
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
  const localTime = data?.local_time || null;
  const offset = Number(localTime?.utc_offset_minutes);
  const utcOffset = Number.isFinite(offset) ? offset : TYUMEN_OFFSET_MIN;
  const effectiveDay =
    localTime?.day || day || dayAtUtcOffset(nowMs, utcOffset);
  const buckets = useMemo(
    () => (Array.isArray(data?.buckets) ? data.buckets : []),
    [data],
  );
  const appsTop = useMemo(
    () => (Array.isArray(data?.apps_top) ? data.apps_top.slice(0, 5) : []),
    [data],
  );
  const hasSchedule = localTime?.work_start_min != null && localTime?.work_end_min != null;

  const captionLocal = hasSchedule
    ? `Местное время: ${localTime?.branch_name || 'Тюмень'} · ${utcOffsetLabel(utcOffset)} · сейчас ${clockAtUtcOffset(nowMs, utcOffset)}`
    : `Время Тюмени: ${utcOffsetLabel(utcOffset)} · сейчас ${clockAtUtcOffset(nowMs, utcOffset)}`;
  const captionSchedule = hasSchedule
    ? `Смена ${hhmm(localTime.work_start_min)}–${hhmm(localTime.work_end_min)}${
        localTime.lunch_start_min != null && localTime.lunch_end_min != null
          ? ` · обед ${hhmm(localTime.lunch_start_min)}–${hhmm(localTime.lunch_end_min)}`
          : ''
      }`
    : `График филиала ${localTime?.branch_name ? `${localTime.branch_name} ` : ''}не задан`;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, flexShrink: 0 }}>
      {loading ? (
        <Stack spacing={1}>
          <Skeleton variant="text" width="45%" />
          <Skeleton variant="rounded" height={26} />
        </Stack>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : (
        <Stack spacing={1.5}>
          {localTime ? (
            <Stack
              direction="row"
              spacing={2}
              alignItems="baseline"
              flexWrap="wrap"
              useFlexGap
              sx={{ rowGap: 0.25 }}
            >
              <Typography variant="caption" color="text.secondary">
                {captionLocal}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {captionSchedule}
              </Typography>
            </Stack>
          ) : null}
          {!buckets.length ? (
            <Typography variant="body2" color="text.secondary">
              Нет данных об активности — нужен агент 1.4.19
            </Typography>
          ) : (
            <>
          <Stack
            direction="row"
            spacing={2.5}
            alignItems="baseline"
            flexWrap="wrap"
            useFlexGap
            sx={{ rowGap: 0.5 }}
          >
            <Typography variant="subtitle2" sx={{ mr: 0.5 }}>
              Первый/последний бакет ввода {summary.first_ts ? `${clockOfEpoch(summary.first_ts, utcOffset)}–${clockOfEpoch(summary.last_ts, utcOffset)}` : ''}
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              Ввод/короткая пауза <b>{formatDwell(summary.active_sec)}</b>
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
            {(Number(summary.break_sec) || 0) > 0 ? (
              <Typography variant="body2" color="info.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                Перерыв <b>{formatDwell(summary.break_sec)}</b>
              </Typography>
            ) : null}
            {(Number(summary.offshift_sec) || 0) > 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                Вне смены <b>{formatDwell(summary.offshift_sec)}</b>
              </Typography>
            ) : null}
            {(Number(summary.active_offshift_sec) || 0) > 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                Ввод вне смены <b>{formatDwell(summary.active_offshift_sec)}</b>
              </Typography>
            ) : null}
            {summary.activity_pct != null ? (
              <Typography variant="body2" color="success.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                Доля активности <b>{summary.activity_pct}%</b>
              </Typography>
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            «Ввод» — фактический ввод плюс до 2 мин после последнего действия; это не оценка
            продуктивности и не отслеживание взгляда.
          </Typography>
          <DlpDayTimeline
            buckets={buckets}
            day={effectiveDay}
            utcOffsetMinutes={utcOffset}
            nowMs={nowMs}
            onOpenBrowser={onOpenBrowser}
          />
          {appsTop.length ? (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {appsTop.map((row) => (
                <Chip
                  key={row.app}
                  size="small"
                  variant="outlined"
                  label={`${displayAppName(row.app)} · ${formatDwell(row.sec)}`}
                />
              ))}
            </Stack>
          ) : null}
            </>
          )}
        </Stack>
      )}
    </Paper>
  );
}
