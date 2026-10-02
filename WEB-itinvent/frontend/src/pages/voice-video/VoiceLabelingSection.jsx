import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined';
import { voiceLabelingAPI } from '../../api/voiceLabeling';
import VoiceLabelEditor from './VoiceLabelEditor';
import { formatDuration } from './labelingModel';

const ACCEPT = '.mp3,.wav,.flac,.m4a,.aac,.ogg,.wma,.mp4,.mkv,.mov,.avi,.webm,.wmv,.flv,.m4v';
const ACTIVE_POLL_MS = 5000;

const STATUS = {
  queued: { label: 'В очереди', color: 'default' },
  processing: { label: 'Строится черновик', color: 'primary' },
  ready: { label: 'Готово к разметке', color: 'success' },
  failed: { label: 'Ошибка', color: 'error' },
};

const extractDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

const formatDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

function NewLabelingDialog({ open, onClose, onCreated }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [withText, setWithText] = useState(true);
  const [minSpeakers, setMinSpeakers] = useState('');
  const [maxSpeakers, setMaxSpeakers] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const reset = () => {
    setFile(null);
    setTitle('');
    setMinSpeakers('');
    setMaxSpeakers('');
    setProgress(0);
    setError('');
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const project = await voiceLabelingAPI.createProject(
        file,
        {
          title: title.trim(),
          settings: {
            with_text: withText,
            min_speakers: Number(minSpeakers) || 0,
            max_speakers: Number(maxSpeakers) || 0,
          },
        },
        (event) => { if (event.total) setProgress(Math.round((event.loaded / event.total) * 100)); },
      );
      reset();
      onCreated?.(project);
    } catch (err) {
      setError(extractDetail(err, 'Не удалось загрузить файл'));
    } finally {
      setBusy(false);
    }
  };

  const speakersInput = (label, value, setValue) => (
    <TextField
      label={label}
      type="number"
      size="small"
      value={value}
      onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
      inputProps={{ min: 1, max: 20, inputMode: 'numeric' }}
      sx={{ width: 140 }}
    />
  );

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Новая разметка</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Paper
            component="label"
            variant="outlined"
            sx={{ p: 2.5, borderStyle: 'dashed', borderWidth: 2, textAlign: 'center', cursor: busy ? 'default' : 'pointer' }}
          >
            <Typography variant="body2">
              {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ` : 'Выберите аудио или видео встречи'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Модель сама разметит, кто когда говорит; вы исправите ошибки и выберете сотрудников
            </Typography>
            <input
              hidden
              type="file"
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => {
                const picked = e.target.files?.[0] || null;
                setFile(picked);
                if (picked && !title) setTitle(picked.name.replace(/\.[^.]+$/, ''));
                e.target.value = '';
              }}
            />
          </Paper>
          <TextField label="Название" size="small" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            {speakersInput('Спикеров от', minSpeakers, setMinSpeakers)}
            {speakersInput('Спикеров до', maxSpeakers, setMaxSpeakers)}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Пусто — модель определит число спикеров сама. Диапазон надёжнее точного числа.
          </Typography>
          <FormControlLabel
            control={<Switch checked={withText} onChange={(e) => setWithText(e.target.checked)} disabled={busy} />}
            label="Добавить текст реплик (дольше, по настройкам распознавания из .env)"
          />
          {busy && <LinearProgress variant={progress ? 'determinate' : 'indeterminate'} value={progress} />}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Отмена</Button>
        <Button variant="contained" onClick={submit} disabled={!file || busy}>Загрузить</Button>
      </DialogActions>
    </Dialog>
  );
}

function VoiceLabelingSection() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editorId, setEditorId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await voiceLabelingAPI.listProjects({ limit: 200 });
      if (!mountedRef.current) return;
      setItems(data.items || []);
      setError('');
    } catch (err) {
      if (!mountedRef.current) return;
      setItems((prev) => prev || []);
      setError(extractDetail(err, 'Не удалось загрузить разметки'));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const hasActive = (items || []).some((p) => ['queued', 'processing'].includes(p.status));
  useEffect(() => {
    if (!hasActive || editorId) return undefined;
    const timer = setInterval(load, ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive, editorId, load]);

  const runAction = async (id, action) => {
    setBusyId(id);
    setActionError('');
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(extractDetail(err, 'Действие не удалось'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (project) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Удалить разметку «${project.title}» вместе с файлом?`)) return;
    runAction(project.id, () => voiceLabelingAPI.deleteProject(project.id));
  };

  if (editorId) {
    return (
      <VoiceLabelEditor
        projectId={editorId}
        onClose={() => { setEditorId(null); load(); }}
      />
    );
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 260px' }}>
          Ручная разметка «кто когда говорит» для проверки и настройки диаризации.
          Модель строит черновик, вы исправляете метки и назначаете сотрудников.
        </Typography>
        <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => setDialogOpen(true)}>
          Новая разметка
        </Button>
      </Stack>
      {error && <Alert severity="error" action={<Button size="small" color="inherit" onClick={load}>Повторить</Button>}>{error}</Alert>}
      {actionError && <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert>}

      {items === null && [0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={64} />)}
      {items && !items.length && !error && (
        <Alert severity="info">Разметок пока нет — загрузите запись встречи.</Alert>
      )}
      {(items || []).map((project) => {
        const st = STATUS[project.status] || { label: project.status, color: 'default' };
        const named = Object.keys(project.speakers || {}).length;
        const job = project.job;
        return (
          <Paper key={project.id} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap title={project.title}>{project.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[
                    project.duration ? formatDuration(project.duration) : null,
                    named ? `назначено сотрудников: ${named}` : null,
                    project.edited_at ? `исправлено ${formatDate(project.edited_at)} · ${project.updated_by || ''}` : `создано ${formatDate(project.created_at)}`,
                  ].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
              <Chip size="small" color={st.color} label={st.label} />
              {project.status === 'ready' && (
                <Button size="small" variant="outlined" startIcon={<EditNoteOutlinedIcon />} onClick={() => setEditorId(project.id)}>
                  Разметить
                </Button>
              )}
              {project.status === 'failed' && (
                <Tooltip title="Построить черновик заново">
                  <span>
                    <IconButton
                      aria-label="Повторить"
                      disabled={busyId === project.id}
                      onClick={() => runAction(project.id, () => voiceLabelingAPI.retryProject(project.id))}
                    >
                      <ReplayOutlinedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <Tooltip title="Удалить">
                <span>
                  <IconButton
                    aria-label="Удалить"
                    disabled={busyId === project.id || ['queued', 'processing'].includes(project.status)}
                    onClick={() => remove(project)}
                  >
                    <DeleteOutlineOutlinedIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
            {['queued', 'processing'].includes(project.status) && (
              <LinearProgress
                sx={{ mt: 1 }}
                variant={job?.progress ? 'determinate' : 'indeterminate'}
                value={job?.progress || 0}
              />
            )}
            {project.status === 'failed' && project.error && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>{project.error}</Typography>
            )}
          </Paper>
        );
      })}

      <NewLabelingDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => { setDialogOpen(false); load(); }}
      />
    </Stack>
  );
}

export default VoiceLabelingSection;
