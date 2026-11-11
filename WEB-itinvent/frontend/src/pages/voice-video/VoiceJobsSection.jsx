import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined';
import SubjectOutlinedIcon from '@mui/icons-material/SubjectOutlined';
import { voiceJobsAPI } from '../../api/voiceJobs';
import VoiceLogViewer from './VoiceLogViewer';

const STATUS_META = {
  queued: { label: 'В очереди', color: 'default' },
  processing: { label: 'Обработка', color: 'primary' },
  done: { label: 'Готово', color: 'success' },
  failed: { label: 'Ошибка', color: 'error' },
  cancelled: { label: 'Отменено', color: 'warning' },
};

const KIND_LABELS = {
  process: 'Новая запись',
  resume: 'Обновление имён',
  enroll: 'Новый голос',
  label: 'Черновик разметки',
};

const STAGE_LABELS = {
  audio: 'Подготовка звука',
  stt: 'Распознавание речи',
  diarization: 'Разделение спикеров',
  speakers: 'Спикеры',
  analysis: 'Анализ',
  insights: 'Выводы',
  reports: 'Отчёты',
};

const PAGE_SIZE = 20;
const DEFAULT_JOB_MINUTES = 60;

const formatTime = (value) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ru-RU', { hour12: false });
  } catch {
    return String(value);
  }
};

const formatSize = (bytes) => {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
};

// Average finished-job duration for the queue estimate («~M мин»).
function avgJobMinutes(jobs) {
  const durations = (jobs || [])
    .filter((j) => j.status === 'done' && j.started_at && j.finished_at)
    .map((j) => (new Date(j.finished_at) - new Date(j.started_at)) / 60000)
    .filter((m) => Number.isFinite(m) && m > 0);
  if (!durations.length) return DEFAULT_JOB_MINUTES;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

function JobsSkeleton() {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" height={44} />
        ))}
      </Stack>
    </Paper>
  );
}

// T26: вместо 1–3 разнотипных иконок — одно меню «⋮» фиксированной ширины.
// Права не меняются: удаление только voice.manage, повтор/отмена — manage или владелец с voice.upload.
const jobTitle = (job) => job.original_filename || job.base_filename || job.id;
const JobActions = ({
  job, active, base, canRetry, canDelete, busy, onCancel, onRetry, onDelete, onOpenMeeting, onShowLog,
}) => {
  const [anchor, setAnchor] = useState(null);
  const title = jobTitle(job);
  const openMeeting = job.kind === 'process' && base && job.status === 'done';
  const canCancel = active;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <IconButton
        size="small"
        aria-label={`Действия с задачей ${title}`}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ '@media (pointer: coarse)': { width: 44, height: 44 } }}
      >
        <MoreVertOutlinedIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => { setAnchor(null); onShowLog?.(job); }}
        >
          <ListItemIcon><SubjectOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Показать лог" />
        </MenuItem>
        {openMeeting && (
          <MenuItem
            onClick={() => { setAnchor(null); onOpenMeeting?.(base); }}
          >
            <ListItemIcon><OpenInNewOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Открыть протокол" />
          </MenuItem>
        )}
        {canRetry && (
          <MenuItem
            disabled={busy}
            onClick={() => { setAnchor(null); onRetry?.(job); }}
          >
            <ListItemIcon><ReplayOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Повторить задачу" />
          </MenuItem>
        )}
        {canCancel && (
          <MenuItem
            disabled={busy}
            onClick={() => { setAnchor(null); onCancel?.(job); }}
          >
            <ListItemIcon><CancelOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Отменить задачу" />
          </MenuItem>
        )}
        {canDelete && (
          <MenuItem
            disabled={busy}
            onClick={() => { setAnchor(null); onDelete?.(job); }}
          >
            <ListItemIcon><DeleteOutlineOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Удалить задачу" />
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
};

const JobRow = React.memo(function JobRow({ job, queueAhead, estimateMin, actions }) {
  const meta = STATUS_META[job.status] || STATUS_META.queued;
  const active = ['queued', 'processing'].includes(job.status);
  return (
    <TableRow hover>
      <TableCell>
        <Typography variant="body2" noWrap sx={{ maxWidth: 320 }}>
          {job.original_filename || job.base_filename || job.id}
        </Typography>
        {job.error && (
          <Typography variant="caption" color="error" noWrap sx={{ maxWidth: 320, display: 'block' }}>
            {job.error}
          </Typography>
        )}
      </TableCell>
      <TableCell>{KIND_LABELS[job.kind] || job.kind}</TableCell>
      <TableCell>
        <Chip size="small" color={meta.color} label={meta.label} variant={active ? 'filled' : 'outlined'} />
      </TableCell>
      <TableCell>
        {job.status === 'processing' ? (
          <Box>
            <LinearProgress variant="determinate" value={job.progress || 0} sx={{ mb: 0.5 }} />
            <Typography variant="caption" color="text.secondary">
              {STAGE_LABELS[job.stage] || job.stage || '—'} · {job.progress || 0}%
            </Typography>
          </Box>
        ) : job.status === 'queued' && queueAhead != null ? (
          <Typography variant="caption" color="text.secondary">
            Впереди: {queueAhead} · ~{estimateMin} мин
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {job.status === 'queued' ? 'Ожидает обработки' : `${job.progress || 0}%`}
          </Typography>
        )}
      </TableCell>
      <TableCell>{formatSize(job.file_size)}</TableCell>
      <TableCell>{job.created_by || '—'}</TableCell>
      <TableCell>{formatTime(job.created_at)}</TableCell>
      <TableCell align="right" sx={{ width: 56 }}>{actions}</TableCell>
    </TableRow>
  );
});

function VoiceJobsSection({
  jobs = [], canManage = false, currentActor = null,
  onCancel, onRetry, onDelete, onOpenMeeting,
  loading = false, error = '', canUpload = false, onUpload,
  busyJobId = null,
  // T45: фильтр может задаваться извне — чипы «Сводки» переводят
  // сюда с нужным статусом («Ошибка», «В очереди»).
  statusFilter: statusFilterProp, onStatusFilterChange,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [page, setPage] = useState(0);
  const [statusFilterState, setStatusFilterState] = useState('');
  const statusFilter = statusFilterProp ?? statusFilterState;
  const setStatusFilter = (value) => {
    setStatusFilterState(value);
    onStatusFilterChange?.(value);
  };
  const [logJob, setLogJob] = useState(null);
  const [logText, setLogText] = useState('');
  const [logBusy, setLogBusy] = useState(false);

  const filtered = useMemo(
    () => (statusFilter ? jobs.filter((j) => j.status === statusFilter) : jobs),
    [jobs, statusFilter],
  );

  // Queue position per queued job: FIFO — сколько активных задач создано раньше.
  // Сервер отдаёт задачи по created_at DESC (новые сверху), поэтому считаем на копии по возрастанию.
  const queuePositions = useMemo(() => {
    const map = new Map();
    let ahead = 0;
    const ordered = [...jobs].sort(
      (a, b) => (new Date(a.created_at).getTime() || 0) - (new Date(b.created_at).getTime() || 0),
    );
    for (const j of ordered) {
      if (!['queued', 'processing'].includes(j.status)) continue;
      if (j.status === 'queued') map.set(j.id, ahead);
      ahead += 1;
    }
    return map;
  }, [jobs]);
  const estimateMin = useMemo(() => Math.max(1, Math.round(avgJobMinutes(jobs))), [jobs]);

  const showLog = async (job) => {
    setLogJob(job);
    setLogText('');
    setLogBusy(true);
    try {
      const data = await voiceJobsAPI.getJobLog(job.id);
      setLogText(data.log_tail || 'Лог пуст');
    } catch {
      setLogText('Не удалось загрузить лог');
    } finally {
      setLogBusy(false);
    }
  };

  // Сервер: manage ИЛИ (upload И владелец) — для владельца без voice.upload кнопки не показываем.
  const canAct = (job) => {
    const isOwner = currentActor && job.created_by === currentActor;
    return { ownerOrManage: canManage || (canUpload && isOwner) };
  };

  const toolbar = (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap' }}>
      <TextField
        select
        size="small"
        value={statusFilter}
        onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
        label="Статус"
        sx={{ minWidth: 160 }}
      >
        <MenuItem value="">Все</MenuItem>
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <MenuItem key={key} value={key}>{meta.label}</MenuItem>
        ))}
      </TextField>
    </Stack>
  );

  const emptyState = (
    <Paper sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary" sx={{ mb: canUpload && !statusFilter ? 2 : 0 }}>
        {statusFilter
          ? 'Задач с таким статусом нет.'
          : 'Задач пока нет. Загрузите аудио/видео через кнопку «Загрузить».'}
      </Typography>
      {canUpload && !statusFilter && (
        <Button variant="contained" onClick={onUpload}>Загрузить запись</Button>
      )}
    </Paper>
  );

  const logDialog = (
    <VoiceLogViewer
      open={Boolean(logJob)}
      onClose={() => setLogJob(null)}
      jobId={logJob?.id}
      logText={logText}
      loading={logBusy}
    />
  );

  if (loading && !jobs.length) {
    return (<>{toolbar}<JobsSkeleton /></>);
  }
  if (!jobs.length || !filtered.length) {
    // При ошибке загрузки не показываем пустое состояние и CTA — сообщение об ошибке выводится отдельно.
    return (<>{toolbar}{error && !jobs.length ? null : emptyState}{logDialog}</>);
  }

  // Данные уже на экране, но идёт перезагрузка — показываем индикатор.
  const busyIndicator = loading ? <LinearProgress sx={{ mb: 1.5 }} /> : null;

  const pageJobs = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (isMobile) {
    return (
      <Box>
        {toolbar}
        {busyIndicator}
        <Stack spacing={1}>
          {pageJobs.map((job) => {
            const meta = STATUS_META[job.status] || STATUS_META.queued;
            const active = ['queued', 'processing'].includes(job.status);
            const base = job.base_filename || (job.result && job.result.base_filename);
            const { ownerOrManage } = canAct(job);
            const ahead = queuePositions.get(job.id);
            return (
              <Paper key={job.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={0.75}>
                  {/* T26: заголовок, статус и «⋮» в одной строке — без ряда разных кнопок. */}
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {jobTitle(job)}
                    </Typography>
                    <Chip size="small" color={meta.color} label={meta.label} variant={active ? 'filled' : 'outlined'} sx={{ flex: '0 0 auto' }} />
                    <JobActions
                      job={job}
                      active={active && ownerOrManage}
                      base={base}
                      canRetry={ownerOrManage && ['failed', 'cancelled'].includes(job.status) && job.kind === 'process'}
                      canDelete={canManage && !active}
                      busy={busyJobId === job.id}
                      onCancel={onCancel}
                      onRetry={onRetry}
                      onDelete={onDelete}
                      onOpenMeeting={onOpenMeeting}
                      onShowLog={showLog}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {KIND_LABELS[job.kind] || job.kind} · {formatTime(job.created_at)} · {job.created_by || '—'}
                  </Typography>
                  {job.status === 'processing' && (
                    <Box>
                      <LinearProgress variant="determinate" value={job.progress || 0} sx={{ mb: 0.5 }} />
                      <Typography variant="caption" color="text.secondary">
                        {STAGE_LABELS[job.stage] || job.stage || '—'} · {job.progress || 0}%
                      </Typography>
                    </Box>
                  )}
                  {job.status === 'queued' && ahead != null && (
                    <Typography variant="caption" color="text.secondary">
                      Впереди: {ahead} · ~{estimateMin} мин
                    </Typography>
                  )}
                  {job.error && (
                    <Typography variant="caption" color="error" noWrap>{job.error}</Typography>
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
        />
        {logDialog}
      </Box>
    );
  }

  return (
    <Box>
      {toolbar}
      {busyIndicator}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Файл</TableCell>
              <TableCell>Тип</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell sx={{ minWidth: 160 }}>Прогресс</TableCell>
              <TableCell>Размер</TableCell>
              <TableCell>Кем создано</TableCell>
              <TableCell>Создано</TableCell>
              {/* T26: фиксированная колонка действий — «⋮» не прыгает между строками. */}
              <TableCell align="right" sx={{ width: 56 }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageJobs.map((job) => {
              const active = ['queued', 'processing'].includes(job.status);
              const base = job.base_filename || (job.result && job.result.base_filename);
              const { ownerOrManage } = canAct(job);
              return (
                <JobRow
                  key={job.id}
                  job={job}
                  queueAhead={queuePositions.get(job.id)}
                  estimateMin={estimateMin}
                  actions={(
                    <JobActions
                      job={job}
                      active={active && ownerOrManage}
                      base={base}
                      canRetry={ownerOrManage && ['failed', 'cancelled'].includes(job.status) && job.kind === 'process'}
                      canDelete={canManage && !active}
                      busy={busyJobId === job.id}
                      onCancel={onCancel}
                      onRetry={onRetry}
                      onDelete={onDelete}
                      onOpenMeeting={onOpenMeeting}
                      onShowLog={showLog}
                    />
                  )}
                />
              );
            })}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
        />
      </TableContainer>
      {logDialog}
    </Box>
  );
}

export default VoiceJobsSection;
