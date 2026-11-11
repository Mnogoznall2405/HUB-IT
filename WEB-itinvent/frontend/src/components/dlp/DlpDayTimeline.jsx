import React, { useMemo } from 'react';
import { Box, Tooltip } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { formatDwell } from './utils';

const CELL_MINUTES = 5;
const CELL_COUNT = (24 * 60) / CELL_MINUTES; // 288

const STATE_KEYS = ['active', 'passive', 'away', 'locked'];
const STATE_LABELS = { active: 'работал', passive: 'пассивно', away: 'отошёл', locked: 'заблокирован' };

function clockLabel(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export default function DlpDayTimeline({ buckets, day }) {
  const theme = useTheme();
  const colors = useMemo(
    () => ({
      active: theme.palette.success.main,
      passive: theme.palette.success.light || theme.palette.info.main,
      away: theme.palette.warning.main,
      locked: theme.palette.action.disabled,
    }),
    [theme],
  );

  const cells = useMemo(() => {
    const dayStart = new Date(`${day}T00:00:00`);
    const map = new Array(CELL_COUNT).fill(null);
    for (const bucket of Array.isArray(buckets) ? buckets : []) {
      const ts = Date.parse(String(bucket?.bucket_start || ''));
      if (!Number.isFinite(ts) || Number.isNaN(dayStart.getTime())) continue;
      const idx = Math.floor((ts - dayStart.getTime()) / (CELL_MINUTES * 60 * 1000));
      if (idx < 0 || idx >= CELL_COUNT) continue;
      map[idx] = bucket;
    }
    return map;
  }, [buckets, day]);

  return (
    <Box>
      <Box
        role="img"
        aria-label="Активность за день по 5-минутным интервалам"
        data-testid="dlp-day-timeline"
        sx={{
          display: 'flex',
          height: 26,
          borderRadius: 0.75,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {cells.map((bucket, idx) => {
          let dominant = '';
          let best = 0;
          const parts = [];
          if (bucket) {
            for (const key of STATE_KEYS) {
              const value = Number(bucket[`${key}_sec`]) || 0;
              if (value > best) {
                best = value;
                dominant = key;
              }
              if (value > 0) parts.push(`${STATE_LABELS[key]} ${formatDwell(value)}`);
            }
          }
          const from = idx * CELL_MINUTES;
          const title = bucket
            ? `${clockLabel(from)}–${clockLabel(from + CELL_MINUTES)} · ${parts.join(', ') || 'нет данных'}${bucket.app ? ` · ${String(bucket.app).replace(/\.exe$/i, '')}` : ''}`
            : `${clockLabel(from)}–${clockLabel(from + CELL_MINUTES)} · нет данных`;
          return (
            <Tooltip key={idx} title={title} arrow>
              <Box
                sx={{
                  flex: '1 1 0',
                  minWidth: 0,
                  bgcolor: dominant ? colors[dominant] : alpha(theme.palette.divider, 0.35),
                  borderRight: idx === CELL_COUNT - 1 ? 0 : '1px solid',
                  borderColor: 'divider',
                }}
              />
            </Tooltip>
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
    </Box>
  );
}
