import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  LinearProgress,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ChevronRightOutlinedIcon from '@mui/icons-material/ChevronRightOutlined';
import { voiceJobsAPI } from '../../api/voiceJobs';

const SUMMARY_PREVIEW_CHARS = 700;

const fmtClock = (sec) => {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// ДД.ММ / ДД.ММ.ГГГГ -> YYYY-MM-DD (год по умолчанию — текущий).
export const parseDeadlineIso = (raw) => {
  const m = /(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/.exec(String(raw || ''));
  if (!m) return null;
  let year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
};

export function assignmentProgress(items, statuses, today = new Date().toISOString().slice(0, 10)) {
  const byKey = new Map((statuses || []).map((s) => [s.key || `#${s.num}`, s]));
  let done = 0;
  let inProgress = 0;
  let overdue = 0;
  for (const item of items || []) {
    const status = byKey.get(item.key || `#${item.num}`)?.status;
    if (status === 'done') {
      done += 1;
      continue;
    }
    if (status === 'in_progress') inProgress += 1;
    const due = parseDeadlineIso(item.deadline);
    if (due && due < today) overdue += 1;
  }
  return { total: (items || []).length, done, inProgress, overdue };
}

function SectionTitle({ children, action }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ mb: 0.75 }}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ flex: 1, lineHeight: 1.6, letterSpacing: '0.06em', fontWeight: 700 }}
      >
        {children}
      </Typography>
      {action}
    </Stack>
  );
}

function TimeLink({ start, onSeek, label }) {
  if (start === null || start === undefined) return null;
  return (
    <ButtonBase
      onClick={() => onSeek?.(start)}
      aria-label={`Перейти к ${fmtClock(start)}${label ? ` — ${label}` : ''}`}
      sx={{
        flexShrink: 0,
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        fontSize: 12,
        fontFamily: 'monospace',
        fontVariantNumeric: 'tabular-nums',
        color: 'primary.main',
        bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
        '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.16) },
      }}
    >
      {fmtClock(start)}
    </ButtonBase>
  );
}

function PointList({ items, onSeek, emptyText }) {
  if (!items.length) {
    return <Typography variant="body2" color="text.secondary">{emptyText}</Typography>;
  }
  return (
    <Stack component="ol" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {items.map((item, idx) => (
        <Stack
          component="li"
          key={`${idx}-${item.text.slice(0, 20)}`}
          direction="row"
          spacing={1}
          alignItems="flex-start"
        >
          <TimeLink start={item.start} onSeek={onSeek} label={item.topic} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ lineHeight: 1.45 }}>{item.text}</Typography>
            {item.topic && (
              <Typography variant="caption" color="text.secondary">{item.topic}</Typography>
            )}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

function Stat({ label, value, tone }) {
  return (
    <Box
      sx={{
        minWidth: 0,
        px: 1.25,
        py: 1,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: tone ? (t) => alpha(t.palette[tone].main, 0.06) : 'transparent',
      }}
    >
      <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: 700, color: tone ? `${tone}.main` : 'text.primary' }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

const markdownSx = {
  '& h1, & h2, & h3': { fontSize: '0.95rem', fontWeight: 700, mt: 1.25, mb: 0.5 },
  '& p': { my: 0.5, lineHeight: 1.55 },
  '& ul, & ol': { pl: 2.5, my: 0.5 },
  '& li': { mb: 0.25 },
  fontSize: '0.875rem',
};

// «Сводка» — первая вкладка карточки встречи: итоги, решения, вопросы, поручения, участники.
function VoiceMeetingSummary({
  base, duration, assignmentItems, unresolvedCount = 0, onSeek, onOpenTab,
}) {
  const [summary, setSummary] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(() => {
    if (!base) return undefined;
    const controller = new AbortController();
    setError('');
    setSummary(null);
    voiceJobsAPI.getSummary(base, { signal: controller.signal })
      .then(setSummary)
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setError('Не удалось загрузить сводку');
      });
    voiceJobsAPI.getAssignmentStatuses(base)
      .then((data) => { if (!controller.signal.aborted) setStatuses(data?.items || []); })
      .catch(() => {});
    return () => controller.abort();
  }, [base]);

  useEffect(() => load(), [load]);

  const progress = useMemo(
    () => assignmentProgress(assignmentItems || [], statuses),
    [assignmentItems, statuses],
  );

  if (error) {
    return <Alert severity="error" action={<Button size="small" onClick={load}>Повторить</Button>}>{error}</Alert>;
  }
  if (!summary) {
    return (
      <Stack spacing={1} aria-label="Загрузка сводки">
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={120} />
        <Skeleton variant="rounded" height={90} />
      </Stack>
    );
  }

  const summaryText = summary.summary || '';
  const longSummary = summaryText.length > SUMMARY_PREVIEW_CHARS;
  const shownSummary = longSummary && !expanded
    ? `${summaryText.slice(0, SUMMARY_PREVIEW_CHARS).replace(/\s+\S*$/, '')}…`
    : summaryText;
  const donePct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const nothing = !summaryText && !summary.decisions.length && !summary.open_questions.length
    && !summary.participants.length && !progress.total;

  return (
    <Stack spacing={2.25} data-testid="meeting-summary">
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fit, minmax(96px, 1fr))' },
        }}
      >
        {(summary.duration || duration) && <Stat label="длительность" value={summary.duration || duration} />}
        <Stat label="решений" value={summary.decisions.length} />
        <Stat
          label={progress.total ? 'выполнено' : 'поручений'}
          value={progress.total ? `${progress.done} / ${progress.total}` : 0}
          tone={progress.total && progress.done === progress.total ? 'success' : undefined}
        />
        {progress.overdue > 0 && <Stat label="просрочено" value={progress.overdue} tone="error" />}
      </Box>

      {unresolvedCount > 0 && (
        <Alert
          severity="warning"
          action={<Button size="small" color="inherit" onClick={() => onOpenTab?.('speakers')}>Назвать</Button>}
        >
          {unresolvedCount === 1 ? 'Один участник без имени' : `Участников без имени: ${unresolvedCount}`}
          {' '}— поручения и протокол станут точнее, если их назвать.
        </Alert>
      )}

      {nothing && (
        <Alert severity="info">Для этой встречи сводка не сформирована — откройте текст или файлы отчёта.</Alert>
      )}

      {summaryText && (
        <Box>
          <SectionTitle>Кратко</SectionTitle>
          <Box sx={markdownSx}>
            <ReactMarkdown>{shownSummary}</ReactMarkdown>
          </Box>
          {longSummary && (
            <Button size="small" onClick={() => setExpanded((v) => !v)} sx={{ mt: 0.5, px: 0.5 }}>
              {expanded ? 'Свернуть' : 'Показать полностью'}
            </Button>
          )}
        </Box>
      )}

      <Box>
        <SectionTitle>Решения</SectionTitle>
        <PointList items={summary.decisions} onSeek={onSeek} emptyText="Решения не зафиксированы." />
      </Box>

      {progress.total > 0 && (
        <Box>
          <SectionTitle
            action={(
              <Button size="small" endIcon={<ChevronRightOutlinedIcon />} onClick={() => onOpenTab?.('assign')}>
                Все поручения
              </Button>
            )}
          >
            Поручения
          </SectionTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <LinearProgress
              variant="determinate"
              value={donePct}
              aria-label={`Выполнено ${progress.done} из ${progress.total}`}
              sx={{ flex: 1, height: 8, borderRadius: 4 }}
              color="success"
            />
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {progress.done} из {progress.total}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {[
              progress.inProgress ? `в работе: ${progress.inProgress}` : null,
              progress.overdue ? `просрочено: ${progress.overdue}` : null,
            ].filter(Boolean).join(' · ') || 'Отмечайте выполнение на вкладке «Поручения».'}
          </Typography>
        </Box>
      )}

      {summary.open_questions.length > 0 && (
        <Box>
          <SectionTitle>Открытые вопросы</SectionTitle>
          <PointList items={summary.open_questions} onSeek={onSeek} emptyText="" />
        </Box>
      )}

      {summary.participants.length > 0 && (
        <Box>
          <SectionTitle>Кто сколько говорил</SectionTitle>
          <Stack spacing={0.75}>
            {summary.participants.slice(0, 8).map((p) => (
              <Box key={p.name}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                  <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{p.name}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, ml: 1 }}>
                    {p.share !== null && p.share !== undefined ? `${Math.round(p.share)}%` : ''}
                  </Typography>
                </Stack>
                <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${Math.min(100, Math.max(2, p.share || 0))}%`, bgcolor: 'primary.main', opacity: 0.75 }} />
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

export default VoiceMeetingSummary;
