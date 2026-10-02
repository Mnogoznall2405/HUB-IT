import React, { memo, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Paper,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';

const WEEK_MS = 7 * 86400 * 1000;
const WEEKS = 8;

function VoiceTrendsStrip({ jobs = [], jobsLoaded = jobs.length > 0, overview = null, queue = null, onJobsFilter }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  // График недель свёрнут по умолчанию (T21): на первом экране остаются чипы.
  const [chartOpen, setChartOpen] = useState(false);
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
    <Paper variant="outlined" sx={{ p: 0.25, mb: 0.25 }}>
      {/* N16: чипы переносятся на вторую строку вместо внутренней
          горизонтальной прокрутки, обрезавшей подписи на 320–390 px. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: { xs: 0.5, sm: 0.75 } }}>
        <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap', lineHeight: 1.2 }}>Сводка</Typography>
        {overview?.meetings_count != null && (
          <Chip size="small" variant="outlined" label={`Встреч: ${overview.meetings_count}`} sx={{ flex: '0 0 auto', height: 22 }} />
        )}
        <Chip
          size="small"
          variant="outlined"
          color="success"
          label={`Готово: ${jobsLoaded ? stats.done : '—'}`}
          sx={{ flex: '0 0 auto', height: 22 }}
        />
        {stats.failed > 0 && (
          <Chip
            size="small"
            variant="outlined"
            color="error"
            label={`Ошибок: ${stats.failed}`}
            // T45: чип — ссылка на вкладку «Задачи» с фильтром «Ошибка».
            clickable={Boolean(onJobsFilter)}
            onClick={onJobsFilter ? () => onJobsFilter('failed') : undefined}
            aria-label={`Показать задачи с ошибками — ошибок: ${stats.failed}`}
            sx={{ flex: '0 0 auto', height: 22 }}
          />
        )}
        {queue && (queue.queued + queue.processing) > 0 && (
          <Chip
            size="small"
            color="primary"
            label={`В очереди: ${queue.queued + queue.processing}`}
            // T45: чип — ссылка на вкладку «Задачи» с фильтром «В очереди».
            clickable={Boolean(onJobsFilter)}
            onClick={onJobsFilter ? () => onJobsFilter('queued') : undefined}
            aria-label={`Показать задачи в очереди — в очереди: ${queue.queued + queue.processing}`}
            sx={{ flex: '0 0 auto', height: 22 }}
          />
        )}
        {!isMobile && (
          <Button
            size="small"
            aria-expanded={chartOpen}
            aria-controls="voice-trends-weeks"
            onClick={() => setChartOpen((value) => !value)}
            endIcon={(
              <ExpandMoreOutlinedIcon
                sx={{ transform: chartOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
              />
            )}
            sx={{ flex: '0 0 auto', ml: 'auto' }}
          >
            Задачи по неделям
          </Button>
        )}
      </Box>
      {!isMobile && (
        <Collapse id="voice-trends-weeks" in={chartOpen} unmountOnExit>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, height: 56, mt: 1 }}>
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
        </Collapse>
      )}
    </Paper>
  );
}

// T46: memo — открытие карточки не перерендеривает сводку.
export default memo(VoiceTrendsStrip);
