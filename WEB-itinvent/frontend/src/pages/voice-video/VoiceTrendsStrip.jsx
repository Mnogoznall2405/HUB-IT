import React, { useMemo } from 'react';
import {
  Box,
  Chip,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';

const WEEK_MS = 7 * 86400 * 1000;
const WEEKS = 8;

function VoiceTrendsStrip({ jobs = [], overview = null, queue = null }) {
  const stats = useMemo(() => {
    const done = jobs.filter((j) => j.status === 'done').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const now = Date.now();
    const buckets = Array.from({ length: WEEKS }, (_, i) => {
      const end = now - i * WEEK_MS;
      const start = end - WEEK_MS;
      const count = jobs.filter((j) => {
        const t = new Date(j.created_at).getTime();
        return Number.isFinite(t) && t >= start && t < end;
      }).length;
      return { count, label: new Date(start).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) };
    }).reverse();
    const max = Math.max(1, ...buckets.map((b) => b.count));
    return { done, failed, buckets, max };
  }, [jobs]);

  if (!jobs.length && !overview) return null;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }} alignItems="center">
        <Typography variant="subtitle2">Сводка</Typography>
        {overview?.meetings_count != null && (
          <Chip size="small" variant="outlined" label={`Встреч: ${overview.meetings_count}`} />
        )}
        <Chip size="small" variant="outlined" color="success" label={`Готово: ${stats.done}`} />
        {stats.failed > 0 && (
          <Chip size="small" variant="outlined" color="error" label={`Ошибок: ${stats.failed}`} />
        )}
        {queue && (queue.queued + queue.processing) > 0 && (
          <Chip size="small" color="primary" label={`В очереди: ${queue.queued + queue.processing}`} />
        )}
      </Stack>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, height: 56 }}>
        {stats.buckets.map((b, i) => (
          <Tooltip key={i} title={`${b.label}: ${b.count} задач`}>
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <Box
                sx={{
                  width: '100%',
                  height: `${Math.max(3, (b.count / stats.max) * 36)}px`,
                  borderRadius: 1,
                  bgcolor: b.count > 0 ? 'primary.main' : 'action.disabledBackground',
                  opacity: b.count > 0 ? 0.85 : 1,
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {b.label}
              </Typography>
            </Box>
          </Tooltip>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Задачи по неделям (последние 8 недель)
      </Typography>
    </Paper>
  );
}

export default VoiceTrendsStrip;
