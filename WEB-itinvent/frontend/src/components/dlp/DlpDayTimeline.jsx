import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { dayAtUtcOffset, displayAppDetail, displayAppName, utcOffsetLabel } from './utils';

const CELL_MINUTES = 5;
const CELL_COUNT = (24 * 60) / CELL_MINUTES; // 288
const DETAILS_LIMIT = 24;
// Print a process name only on runs of >=2 h — on narrow viewports an inline
// name under that threshold would be a few unreadable pixels. Shorter runs
// still name the process in the accessible interval list.
const APP_LABEL_MIN_CELLS = 24;

const STATE_KEYS = ['active', 'passive', 'away', 'locked', 'break', 'offshift'];
const STATE_LABELS = {
  active: 'ввод/короткая пауза',
  passive: 'пассивно',
  away: 'отошёл',
  locked: 'заблокирован',
  break: 'перерыв',
  offshift: 'вне смены',
  unknown: 'Нет данных',
};
const NO_APP_LABEL = 'приложение не фиксировалось';
// Palette tokens for per-app runs; a stable name hash keeps one process the
// same colour across days without a server-side colour map.
const APP_PALETTE_KEYS = ['primary', 'secondary', 'info', 'success', 'warning'];

function bucketSignal(bucket) {
  let state = 'unknown';
  let best = 0;
  for (const key of STATE_KEYS) {
    const seconds = Math.max(0, Number(bucket?.[`${key}_sec`]) || 0);
    if (seconds > best) {
      best = seconds;
      state = key;
    }
  }
  const foregroundSeconds =
    (Number(bucket?.active_sec) || 0) + (Number(bucket?.passive_sec) || 0);
  const app = foregroundSeconds > 0 ? displayAppName(bucket?.app) : '';
  const appDetail = foregroundSeconds > 0 ? displayAppDetail(bucket?.app) : '';
  const label =
    state === 'active' && bucket?.zone === 'off'
      ? 'Ввод вне смены'
      : STATE_LABELS[state] || 'Нет данных';
  return { state, label, app, appDetail };
}

function joinRuns(cells, selector) {
  const runs = [];
  cells.forEach((cell, index) => {
    const value = selector(cell);
    const last = runs[runs.length - 1];
    if (last && last.value === value) last.end = index + 1;
    else runs.push({ start: index, end: index + 1, value });
  });
  return runs;
}

function appPaletteKey(name) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return APP_PALETTE_KEYS[hash % APP_PALETTE_KEYS.length];
}

function clockLabel(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Two labelled rails over the branch-local day: dominant PC state and dominant
 * foreground process per 5-minute bucket, grouped into runs. The interval list
 * is the authoritative, keyboard-readable view — opened in a dialog so the
 * host card never grows when it is shown.
 */
export default function DlpDayTimeline({
  buckets,
  day,
  utcOffsetMinutes = 300,
  nowMs = Date.now(),
  onOpenBrowser,
}) {
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down('sm'));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsAll, setDetailsAll] = useState(false);
  const colors = useMemo(
    () => ({
      active: theme.palette.success.main,
      passive: theme.palette.success.light || theme.palette.info.main,
      away: theme.palette.warning.main,
      locked: theme.palette.action.disabled,
      break: theme.palette.info.main,
      offshift: theme.palette.grey[400] || theme.palette.action.disabledBackground,
      unknown: alpha(theme.palette.divider, 0.35),
    }),
    [theme],
  );

  const signals = useMemo(() => {
    // Branch-local day anchored at UTC midnight: a bucket lands in cell N by
    // its instant shifted into the branch offset — the viewer's own timezone
    // plays no role in where the strip paints it.
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    const map = new Array(CELL_COUNT).fill(null);
    for (const bucket of Array.isArray(buckets) ? buckets : []) {
      const ts = Date.parse(String(bucket?.bucket_start || ''));
      if (!Number.isFinite(ts) || !Number.isFinite(dayStart)) continue;
      const idx = Math.floor(
        (ts + utcOffsetMinutes * 60000 - dayStart) / (CELL_MINUTES * 60 * 1000),
      );
      if (idx < 0 || idx >= CELL_COUNT) continue;
      map[idx] = bucket;
    }
    return map.map(bucketSignal);
  }, [buckets, day, utcOffsetMinutes]);

  const stateRuns = useMemo(() => joinRuns(signals, (signal) => signal.label), [signals]);
  // 'missing' keeps unobserved segments from merging with observed-but-no-app
  // segments — an app-less away/locked stretch is telemetry, not a gap.
  const appRuns = useMemo(
    () => joinRuns(signals, (signal) => (signal.state === 'unknown' ? 'missing' : `app:${signal.app}`)),
    [signals],
  );
  const intervalRuns = useMemo(
    () => joinRuns(signals, (signal) => `${signal.state}|${signal.label}|${signal.app}`),
    [signals],
  );

  const nowPct = useMemo(() => {
    if (dayAtUtcOffset(nowMs, utcOffsetMinutes) !== day) return null;
    const shifted = new Date(nowMs + utcOffsetMinutes * 60000);
    const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
    return (minutes / 1440) * 100;
  }, [nowMs, utcOffsetMinutes, day]);

  const offsetLabel = utcOffsetLabel(utcOffsetMinutes);
  const visibleIntervals = detailsAll ? intervalRuns : intervalRuns.slice(0, DETAILS_LIMIT);
  const legendKeys = [...STATE_KEYS, 'unknown'];

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        Состояние ПК
      </Typography>
      <Box sx={{ position: 'relative' }}>
        <Box
          role="img"
          aria-label={`Состояние ПК за местный день филиала (${offsetLabel}), 5-минутные интервалы`}
          data-testid="dlp-day-timeline"
          sx={{
            display: 'flex',
            height: 20,
            borderRadius: 0.75,
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          {stateRuns.map((run) => {
            const signal = signals[run.start];
            const range = `${clockLabel(run.start * CELL_MINUTES)}–${clockLabel(run.end * CELL_MINUTES)}`;
            return (
              <Box
                key={run.start}
                title={`${range} · ${signal.label}`}
                sx={{
                  flex: `0 0 ${((run.end - run.start) / CELL_COUNT) * 100}%`,
                  minWidth: 0,
                  bgcolor: colors[signal.state] || colors.unknown,
                }}
              />
            );
          })}
        </Box>
        {nowPct != null ? (
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              top: -2,
              bottom: -2,
              left: `${nowPct}%`,
              width: 2,
              bgcolor: 'error.main',
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
        Приложение в фокусе
      </Typography>
      <Box
        role="img"
        aria-label={`Приложение в фокусе за местный день филиала (${offsetLabel}), приложение среди секунд ввода и короткой паузы`}
        sx={{
          display: 'flex',
          height: 20,
          borderRadius: 0.75,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {appRuns.map((run, runIndex) => {
          const signal = signals[run.start];
          const range = `${clockLabel(run.start * CELL_MINUTES)}–${clockLabel(run.end * CELL_MINUTES)}`;
          const appColor = signal.app
            ? theme.palette[appPaletteKey(signal.app)]?.main || theme.palette.primary.main
            : colors.unknown;
          const title =
            signal.state === 'unknown'
              ? `${range} · Нет данных`
              : `${range} · ${signal.appDetail || NO_APP_LABEL}`;
          return (
            <Box
              key={run.start}
              title={title}
              sx={{
                flex: `0 0 ${((run.end - run.start) / CELL_COUNT) * 100}%`,
                minWidth: 0,
                bgcolor: appColor,
                // Process colours come from a name hash — a thin boundary keeps
                // two neighbours with a collided colour distinguishable.
                borderInlineEnd:
                  runIndex < appRuns.length - 1 ? `1px solid ${theme.palette.background.paper}` : 0,
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
              }}
            >
              {signal.app && run.end - run.start >= APP_LABEL_MIN_CELLS ? (
                <Box
                  component="span"
                  sx={{
                    display: { xs: 'none', md: 'block' },
                    px: 0.5,
                    fontSize: 10,
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: theme.palette.getContrastText(appColor),
                  }}
                >
                  {signal.app}
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Box sx={{ position: 'relative', height: 14, mt: 0.5 }}>
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
          <Box
            key={hour}
            component="span"
            sx={{
              position: 'absolute',
              left: `${(hour / 24) * 100}%`,
              transform: hour === 0 ? 'none' : hour === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
              fontSize: 10,
              color: 'text.disabled',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {hour}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.25, rowGap: 0.25, mt: 0.5 }}>
        {legendKeys.map((key) => (
          <Box
            key={key}
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <Box
              component="span"
              aria-hidden="true"
              sx={{
                width: 10,
                height: 10,
                borderRadius: 0.25,
                bgcolor: colors[key],
                border: '1px solid',
                borderColor: 'divider',
              }}
            />
            <Typography variant="caption" component="span" color="text.secondary">
              {STATE_LABELS[key]}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
        Состояние — преобладающее за 5 минут; приложение — наиболее частое
        только во время ввода или короткой паузы, не за весь интервал. Цвет полосы
        различает приложения, а не оценивает работу; фокус окна не доказывает работу.
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1 }}>
        <Button
          size="small"
          variant="text"
          aria-haspopup="dialog"
          onClick={() => setDetailsOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Интервалы по времени
        </Button>
        {onOpenBrowser ? (
          <Button
            size="small"
            variant="text"
            onClick={onOpenBrowser}
            sx={{ textTransform: 'none' }}
          >
            Вкладки в фокусе
          </Button>
        ) : null}
      </Box>
      <Dialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        fullScreen={isNarrow}
        fullWidth
        maxWidth="sm"
        aria-labelledby="dlp-day-intervals-title"
      >
        <DialogTitle id="dlp-day-intervals-title">{`Интервалы · ${day} · ${offsetLabel}`}</DialogTitle>
        <DialogContent dividers tabIndex={0} sx={{ minHeight: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            Преобладающее состояние и приложение во время ввода/короткой паузы в каждом 5-минутном срезе
          </Typography>
          <Box component="ol" sx={{ m: 0, mt: 0.25, pl: 2.25 }}>
            {visibleIntervals.map((run) => {
              const signal = signals[run.start];
              const range = `${clockLabel(run.start * CELL_MINUTES)}–${clockLabel(run.end * CELL_MINUTES)}`;
              const text =
                signal.state === 'unknown'
                  ? `${range} · Нет данных`
                  : `${range} · ${signal.label} · ${signal.appDetail || NO_APP_LABEL}`;
              return (
                <Box
                  component="li"
                  key={run.start}
                  sx={{
                    fontSize: { xs: 14, sm: 13 },
                    overflowWrap: 'break-word',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {text}
                </Box>
              );
            })}
          </Box>
          {intervalRuns.length > DETAILS_LIMIT && !detailsAll ? (
            <Button
              size="small"
              variant="text"
              onClick={() => setDetailsAll(true)}
              sx={{ textTransform: 'none' }}
            >
              {`Показать остальные (${intervalRuns.length - DETAILS_LIMIT})`}
            </Button>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
