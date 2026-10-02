import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import CallMergeOutlinedIcon from '@mui/icons-material/CallMergeOutlined';
import ContentCutOutlinedIcon from '@mui/icons-material/ContentCutOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined';
import { voiceLabelingAPI } from '../../api/voiceLabeling';
import { hubTaskSupportAPI } from '../../api/hubTaskSupport';
import {
  addSegmentAt,
  assignSpeaker,
  deleteSegment,
  findSegmentIndexAt,
  formatDuration,
  formatTime,
  labelingSnapshot,
  mergeWithPrevious,
  nextSpeakerLabel,
  pruneSpeakers,
  relabelSpeaker,
  setBoundary,
  sortSegments,
  speakerColor,
  speakerOrder,
  speakerStats,
  splitSegment,
} from './labelingModel';

const AUTOSAVE_MS = 30000;
const HISTORY_LIMIT = 100;
const SEEK_STEP = 2;
const SEEK_STEP_LONG = 10;

const SHORTCUTS = [
  ['Пробел', 'пауза / воспроизведение'],
  ['← / →', `перемотка на ${SEEK_STEP} с (Shift — ${SEEK_STEP_LONG} с)`],
  ['↑ / ↓', 'предыдущая / следующая реплика'],
  ['1–9', 'назначить спикера реплике'],
  ['S', 'разрезать реплику в текущей точке'],
  ['M', 'слить с предыдущей репликой'],
  ['[ / ]', 'начало / конец реплики = текущее время'],
  ['N', 'новая реплика в текущей точке'],
  ['Delete', 'удалить реплику'],
  ['Ctrl+Z', 'отменить'],
  ['Ctrl+S', 'сохранить'],
];

const extractDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

// Inputs keep their keys; focused media controls handle space/arrows natively.
const isTypingTarget = (target) => {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return ['input', 'textarea', 'select', 'video', 'audio'].includes(tag) || target.isContentEditable;
};

const userLabel = (u) => u?.full_name || u?.name || u?.username || u?.login || '';

function EmployeePicker({ value, onChange, disabled }) {
  const [input, setInput] = useState(value?.name || '');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => { setInput(value?.name || ''); }, [value?.name]);

  useEffect(() => {
    const q = input.trim();
    if (q.length < 2 || q === value?.name) return undefined;
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      hubTaskSupportAPI.getAssignees({ q, limit: 20 })
        .then((data) => { if (seq === seqRef.current) setOptions(data?.items || data || []); })
        .catch(() => { if (seq === seqRef.current) setOptions([]); })
        .finally(() => { if (seq === seqRef.current) setLoading(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [input, value?.name]);

  return (
    <Autocomplete
      freeSolo
      size="small"
      disabled={disabled}
      options={options}
      loading={loading}
      filterOptions={(x) => x}
      getOptionLabel={(o) => (typeof o === 'string' ? o : userLabel(o))}
      isOptionEqualToValue={(o, v) => (o?.id ?? o) === (v?.id ?? v)}
      value={value?.name ? { id: value.user_id, full_name: value.name } : null}
      inputValue={input}
      onInputChange={(_e, v, reason) => { if (reason !== 'reset') setInput(v); }}
      onChange={(_e, v) => {
        if (!v) onChange(null);
        else if (typeof v === 'string') onChange(v.trim() ? { name: v.trim(), user_id: null } : null);
        else onChange({ name: userLabel(v), user_id: v.id ?? null });
      }}
      onBlur={() => {
        const typed = input.trim();
        if (typed && typed !== (value?.name || '')) onChange({ name: typed, user_id: null });
        if (!typed && value?.name) onChange(null);
      }}
      renderOption={(props, o) => (
        <li {...props} key={o.id ?? userLabel(o)}>
          <Box>
            <Typography variant="body2">{userLabel(o)}</Typography>
            {(o.department || o.position) && (
              <Typography variant="caption" color="text.secondary">
                {[o.position, o.department].filter(Boolean).join(' · ')}
              </Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Сотрудник или имя"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress size={14} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      sx={{ flex: '1 1 180px', minWidth: 160 }}
    />
  );
}

const SegmentRow = memo(function SegmentRow({
  seg, color, speakerName, selected, playing, canSplit,
  onSeek, onSelect, onSpeakerClick, onSplit, onMerge, onDelete,
}) {
  return (
    <Box
      data-seg-id={seg.id}
      onClick={() => onSelect(seg.id)}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        px: 1,
        py: 0.75,
        borderLeft: '4px solid',
        borderLeftColor: color,
        borderRadius: 1,
        bgcolor: playing ? 'action.selected' : 'transparent',
        outline: selected ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: -2,
        cursor: 'pointer',
        contentVisibility: 'auto',
        containIntrinsicSize: '0 48px',
        '&:hover': { bgcolor: playing ? 'action.selected' : 'action.hover' },
      }}
    >
      <Button
        size="small"
        onClick={(e) => { e.stopPropagation(); onSeek(seg); }}
        sx={{ minWidth: 0, px: 0.5, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap', flex: '0 0 auto' }}
      >
        {formatTime(seg.start)}–{formatTime(seg.end)}
      </Button>
      <Chip
        size="small"
        label={speakerName}
        onClick={(e) => { e.stopPropagation(); onSpeakerClick(e.currentTarget, seg.id); }}
        sx={{ bgcolor: color, color: '#fff', maxWidth: 180, flex: '0 0 auto', fontWeight: 600 }}
      />
      <Typography
        variant="body2"
        color={seg.text ? 'text.primary' : 'text.disabled'}
        sx={{ flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word', pt: 0.25 }}
      >
        {seg.text || '—'}
      </Typography>
      <Stack direction="row" sx={{ flex: '0 0 auto' }}>
        <Tooltip title="Разрезать в текущей точке (S)">
          <span>
            <IconButton size="small" aria-label="Разрезать" disabled={!canSplit} onClick={(e) => { e.stopPropagation(); onSplit(seg.id); }}>
              <ContentCutOutlinedIcon fontSize="inherit" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Слить с предыдущей (M)">
          <IconButton size="small" aria-label="Слить с предыдущей" onClick={(e) => { e.stopPropagation(); onMerge(seg.id); }}>
            <CallMergeOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Удалить (Delete)">
          <IconButton size="small" aria-label="Удалить реплику" onClick={(e) => { e.stopPropagation(); onDelete(seg.id); }}>
            <DeleteOutlineOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
});

function VoiceLabelEditor({ projectId, onClose }) {
  const [project, setProject] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [segments, setSegments] = useState([]);
  const [speakers, setSpeakers] = useState({});
  const [extraLabels, setExtraLabels] = useState([]);
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [follow, setFollow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [notice, setNotice] = useState('');
  const [speakerMenu, setSpeakerMenu] = useState(null); // { anchor, segId }
  const [mergeMenu, setMergeMenu] = useState(null); // { anchor, label }
  const [exportMenu, setExportMenu] = useState(null);
  const mediaRef = useRef(null);
  const listRef = useRef(null);
  const stateRef = useRef({});

  const applyLoaded = useCallback((data) => {
    const segs = sortSegments(data.segments || []);
    const spk = data.speakers || {};
    setProject(data);
    setSegments(segs);
    setSpeakers(spk);
    setExtraLabels([]);
    setTitle(data.title || '');
    setVersion(data.version || 0);
    setSavedSnapshot(labelingSnapshot(segs, pruneSpeakers(spk, segs, []), data.title || ''));
    setHistory([]);
    setConflict(false);
    setSaveError('');
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      applyLoaded(await voiceLabelingAPI.getProject(projectId));
    } catch (err) {
      setLoadError(extractDetail(err, 'Не удалось загрузить разметку'));
    }
  }, [projectId, applyLoaded]);

  useEffect(() => { load(); }, [load]);

  const order = useMemo(() => speakerOrder(segments, extraLabels), [segments, extraLabels]);
  const stats = useMemo(() => speakerStats(segments), [segments]);
  const currentIdx = useMemo(() => findSegmentIndexAt(segments, currentTime), [segments, currentTime]);
  const currentId = currentIdx >= 0 ? segments[currentIdx].id : null;
  const prunedSpeakers = useMemo(() => pruneSpeakers(speakers, segments, extraLabels), [speakers, segments, extraLabels]);
  const dirty = Boolean(project) && labelingSnapshot(segments, prunedSpeakers, title) !== savedSnapshot;
  const duration = Number(project?.duration) || 0;
  const nameOf = useCallback((label) => speakers[label]?.name || label, [speakers]);

  // Every edit goes through here so it can be undone.
  const commit = useCallback((next) => {
    if (!next) return false;
    setHistory((h) => [...h.slice(-(HISTORY_LIMIT - 1)), stateRef.current.segments]);
    setSegments(sortSegments(next));
    return true;
  }, []);

  const undo = useCallback(() => {
    const h = stateRef.current.history;
    if (!h?.length) return;
    setSegments(h[h.length - 1]);
    setHistory(h.slice(0, -1));
  }, []);

  const seek = useCallback((t, play = false) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, t);
    setCurrentTime(media.currentTime);
    if (play) media.play().catch(() => {});
  }, []);

  const save = useCallback(async () => {
    const st = stateRef.current;
    if (st.saving || st.conflict || !st.project) return;
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        version: st.version,
        segments: st.segments,
        speakers: st.prunedSpeakers,
        title: st.title.trim() || undefined,
      };
      const data = await voiceLabelingAPI.saveProject(projectId, payload);
      setVersion(data.version);
      setProject((prev) => ({ ...prev, ...data, segments: undefined }));
      setSavedSnapshot(labelingSnapshot(st.segments, st.prunedSpeakers, st.title));
      setSavedAt(new Date());
    } catch (err) {
      if (err?.response?.status === 409) setConflict(true);
      setSaveError(extractDetail(err, 'Не удалось сохранить'));
    } finally {
      setSaving(false);
    }
  }, [projectId]);

  stateRef.current = {
    segments, version, title, prunedSpeakers, saving, conflict, project, order, selectedId, currentId,
    currentTime, duration, history,
  };

  // Autosave after a pause in editing.
  useEffect(() => {
    if (!dirty || conflict) return undefined;
    const timer = setTimeout(() => { save(); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, conflict, segments, speakers, title, save]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Keep the playing row visible.
  useEffect(() => {
    if (!follow || !currentId || !listRef.current) return;
    const media = mediaRef.current;
    if (media && media.paused) return;
    const row = listRef.current.querySelector(`[data-seg-id="${CSS.escape(currentId)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [currentId, follow]);

  const targetId = () => stateRef.current.selectedId || stateRef.current.currentId;

  const doSplit = useCallback((id) => {
    const res = splitSegment(stateRef.current.segments, id, stateRef.current.currentTime);
    if (!res) {
      setNotice('Поставьте плеер внутрь реплики, не у самой границы');
      return;
    }
    commit(res.segments);
    setSelectedId(res.newId);
  }, [commit]);

  const doMerge = useCallback((id) => {
    const res = mergeWithPrevious(stateRef.current.segments, id);
    if (!res) return;
    commit(res.segments);
    setSelectedId(res.keptId);
  }, [commit]);

  const doDelete = useCallback((id) => {
    commit(deleteSegment(stateRef.current.segments, id));
    setSelectedId(null);
  }, [commit]);

  const doAssign = useCallback((id, label) => {
    if (!id || !label) return;
    commit(assignSpeaker(stateRef.current.segments, id, label));
  }, [commit]);

  const doBoundary = useCallback((id, edge) => {
    const st = stateRef.current;
    const next = setBoundary(st.segments, id, edge, st.currentTime, st.duration);
    if (!next) {
      setNotice(edge === 'start' ? 'Начало должно быть раньше конца реплики' : 'Конец должен быть позже начала реплики');
      return;
    }
    commit(next);
  }, [commit]);

  const doAdd = useCallback(() => {
    const st = stateRef.current;
    const sel = st.segments.find((s) => s.id === st.selectedId);
    const label = sel?.speaker || st.order[0] || 'SPEAKER_00';
    const res = addSegmentAt(st.segments, st.currentTime, label, st.duration);
    if (!res) return;
    commit(res.segments);
    setSelectedId(res.newId);
  }, [commit]);

  const addSpeaker = () => {
    const label = nextSpeakerLabel(order);
    setExtraLabels((prev) => [...prev, label]);
    return label;
  };

  const selectNeighbor = useCallback((delta) => {
    const st = stateRef.current;
    if (!st.segments.length) return;
    const base = st.segments.findIndex((s) => s.id === (st.selectedId || st.currentId));
    const idx = Math.min(st.segments.length - 1, Math.max(0, (base < 0 ? 0 : base + delta)));
    const seg = st.segments[idx];
    setSelectedId(seg.id);
    seek(seg.start);
    listRef.current?.querySelector(`[data-seg-id="${CSS.escape(seg.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [seek]);

  useEffect(() => {
    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;
      const media = mediaRef.current;
      const key = e.key;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const id = targetId();
      const code = e.code;
      if (code === 'Space') {
        e.preventDefault();
        if (media) (media.paused ? media.play().catch(() => {}) : media.pause());
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        e.preventDefault();
        const step = (e.shiftKey ? SEEK_STEP_LONG : SEEK_STEP) * (key === 'ArrowLeft' ? -1 : 1);
        seek((media?.currentTime || 0) + step);
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
        selectNeighbor(key === 'ArrowUp' ? -1 : 1);
      } else if (/^(Digit|Numpad)[1-9]$/.test(code)) {
        const label = stateRef.current.order[Number(code.slice(-1)) - 1];
        if (label) doAssign(id, label);
      } else if (code === 'KeyS') {
        if (id) doSplit(id);
      } else if (code === 'KeyM') {
        if (id) doMerge(id);
      } else if (code === 'BracketLeft') {
        if (id) doBoundary(id, 'start');
      } else if (code === 'BracketRight') {
        if (id) doBoundary(id, 'end');
      } else if (code === 'KeyN') {
        doAdd();
      } else if (key === 'Delete') {
        if (id) doDelete(id);
      } else if (key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doAdd, doAssign, doBoundary, doDelete, doMerge, doSplit, save, seek, selectNeighbor, undo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const handleClose = () => {
    // eslint-disable-next-line no-alert
    if (dirty && !window.confirm('Есть несохранённые изменения. Закрыть без сохранения?')) return;
    onClose?.();
  };

  const playSample = (label) => {
    const longest = stats[label]?.longest;
    if (longest) {
      setSelectedId(longest.id);
      seek(longest.start, true);
    }
  };

  const onSeekRow = useCallback((seg) => { setSelectedId(seg.id); seek(seg.start, true); }, [seek]);
  const onSpeakerClick = useCallback((anchor, segId) => setSpeakerMenu({ anchor, segId }), []);

  if (loadError) {
    return (
      <Stack spacing={1}>
        <Button startIcon={<ArrowBackOutlinedIcon />} onClick={onClose} sx={{ alignSelf: 'flex-start' }}>К списку</Button>
        <Alert severity="error" action={<Button size="small" color="inherit" onClick={load}>Повторить</Button>}>{loadError}</Alert>
      </Stack>
    );
  }
  if (!project) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  const mediaSrc = voiceLabelingAPI.mediaUrl(projectId);
  const isVideo = project.media_kind === 'video';
  const selected = segments.find((s) => s.id === selectedId) || null;
  const saveStatus = saving
    ? 'Сохранение…'
    : dirty
      ? 'Есть несохранённые изменения'
      : savedAt
        ? `Сохранено в ${savedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
        : 'Сохранено';

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button startIcon={<ArrowBackOutlinedIcon />} onClick={handleClose}>К списку</Button>
        <TextField
          size="small"
          label="Название"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ flex: '1 1 220px', minWidth: 180 }}
        />
        <Typography variant="caption" color={dirty ? 'warning.main' : 'text.secondary'} sx={{ minWidth: 120 }}>
          {saveStatus}
        </Typography>
        <Tooltip title="Отменить (Ctrl+Z)">
          <span>
            <IconButton aria-label="Отменить" onClick={undo} disabled={!history.length}>
              <UndoOutlinedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip
          title={(
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1 }}>
              {SHORTCUTS.map(([k, v]) => (
                <React.Fragment key={k}>
                  <Box component="dt" sx={{ fontWeight: 700 }}>{k}</Box>
                  <Box component="dd" sx={{ m: 0 }}>{v}</Box>
                </React.Fragment>
              ))}
            </Box>
          )}
        >
          <IconButton aria-label="Горячие клавиши"><HelpOutlineOutlinedIcon /></IconButton>
        </Tooltip>
        <Button startIcon={<DownloadOutlinedIcon />} onClick={(e) => setExportMenu(e.currentTarget)}>RTTM</Button>
        <Button
          variant="contained"
          startIcon={<SaveOutlinedIcon />}
          onClick={save}
          disabled={saving || conflict || !dirty}
        >
          Сохранить
        </Button>
      </Stack>

      {conflict && (
        <Alert
          severity="warning"
          action={<Button size="small" color="inherit" onClick={load}>Загрузить заново</Button>}
        >
          {saveError || 'Разметку изменили в другом окне.'} Ваши несохранённые правки будут потеряны при перезагрузке.
        </Alert>
      )}
      {!conflict && saveError && <Alert severity="error" onClose={() => setSaveError('')}>{saveError}</Alert>}
      {notice && <Alert severity="info" onClose={() => setNotice('')}>{notice}</Alert>}

      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(280px, 1fr)' } }}>
        <Stack spacing={1} sx={{ minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 1 }}>
            {isVideo ? (
              <Box
                component="video"
                ref={mediaRef}
                src={mediaSrc}
                controls
                preload="metadata"
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
                sx={{ width: '100%', maxHeight: '40vh', bgcolor: '#000', borderRadius: 1, display: 'block' }}
              />
            ) : (
              <Box
                component="audio"
                ref={mediaRef}
                src={mediaSrc}
                controls
                preload="metadata"
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
                sx={{ width: '100%', display: 'block' }}
              />
            )}
            <Timeline
              segments={segments}
              order={order}
              duration={duration}
              currentTime={currentTime}
              selectedId={selectedId}
              onSeek={(t) => seek(t)}
            />
          </Paper>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{formatTime(currentTime)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 auto' }}>
              {segments.length} реплик · {order.length} спикеров
              {selected ? ` · выбрана ${formatTime(selected.start)}–${formatTime(selected.end)}` : ''}
            </Typography>
            <Button size="small" startIcon={<AddOutlinedIcon />} onClick={doAdd}>Реплика здесь (N)</Button>
            <Button size="small" disabled={!targetId()} onClick={() => doBoundary(targetId(), 'start')}>Начало = сейчас</Button>
            <Button size="small" disabled={!targetId()} onClick={() => doBoundary(targetId(), 'end')}>Конец = сейчас</Button>
            <FormControlLabel
              control={<Switch size="small" checked={follow} onChange={(e) => setFollow(e.target.checked)} />}
              label={<Typography variant="caption">Следовать за плеером</Typography>}
            />
          </Stack>

          <Paper
            variant="outlined"
            ref={listRef}
            sx={{ p: 0.5, maxHeight: { xs: '55vh', md: 'calc(100vh - 420px)' }, minHeight: 240, overflowY: 'auto' }}
          >
            {!segments.length && (
              <Alert severity="info" sx={{ m: 1 }}>Реплик нет — поставьте плеер на речь и нажмите N.</Alert>
            )}
            <Stack spacing={0.25}>
              {segments.map((seg) => (
                <SegmentRow
                  key={seg.id}
                  seg={seg}
                  color={speakerColor(seg.speaker, order)}
                  speakerName={nameOf(seg.speaker)}
                  selected={seg.id === selectedId}
                  playing={seg.id === currentId}
                  canSplit={seg.id === currentId}
                  onSeek={onSeekRow}
                  onSelect={setSelectedId}
                  onSpeakerClick={onSpeakerClick}
                  onSplit={doSplit}
                  onMerge={doMerge}
                  onDelete={doDelete}
                />
              ))}
            </Stack>
          </Paper>
        </Stack>

        <Paper variant="outlined" sx={{ p: 1.5, alignSelf: 'start' }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>Спикеры</Typography>
            <Button size="small" startIcon={<AddOutlinedIcon />} onClick={addSpeaker}>Добавить</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Прослушайте образец и выберите сотрудника. Если модель разбила одного человека на двоих —
            объедините метки.
          </Typography>
          <Stack spacing={1.25} divider={<Divider flexItem />}>
            {order.map((label, idx) => {
              const st = stats[label];
              return (
                <Stack key={label} spacing={0.75}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: speakerColor(label, order), flex: '0 0 auto' }} />
                    <Typography variant="body2" sx={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0 }} noWrap>
                      {idx < 9 ? `${idx + 1}. ` : ''}{label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: '0 0 auto' }}>
                      {st ? `${st.count} · ${formatDuration(st.total)}` : 'нет реплик'}
                    </Typography>
                    <Tooltip title="Прослушать самую длинную реплику">
                      <span>
                        <IconButton size="small" aria-label={`Прослушать ${label}`} disabled={!st} onClick={() => playSample(label)}>
                          <PlayArrowOutlinedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Объединить с другим спикером">
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Объединить ${label}`}
                          disabled={!st || order.length < 2}
                          onClick={(e) => setMergeMenu({ anchor: e.currentTarget, label })}
                        >
                          <CallMergeOutlinedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                  <EmployeePicker
                    value={speakers[label]}
                    onChange={(v) => setSpeakers((prev) => {
                      const next = { ...prev };
                      if (v) next[label] = v; else delete next[label];
                      return next;
                    })}
                  />
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      </Box>

      <Menu open={Boolean(speakerMenu)} anchorEl={speakerMenu?.anchor} onClose={() => setSpeakerMenu(null)}>
        {order.map((label, idx) => (
          <MenuItem
            key={label}
            onClick={() => { doAssign(speakerMenu.segId, label); setSpeakerMenu(null); }}
          >
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: speakerColor(label, order), mr: 1 }} />
            {idx < 9 ? `${idx + 1}. ` : ''}{nameOf(label)}
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => {
            const label = addSpeaker();
            doAssign(speakerMenu.segId, label);
            setSpeakerMenu(null);
          }}
        >
          <AddOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Новый спикер
        </MenuItem>
      </Menu>

      <Menu open={Boolean(mergeMenu)} anchorEl={mergeMenu?.anchor} onClose={() => setMergeMenu(null)}>
        <MenuItem disabled>Перенести все реплики {mergeMenu?.label} в…</MenuItem>
        {order.filter((l) => l !== mergeMenu?.label).map((label) => (
          <MenuItem
            key={label}
            onClick={() => {
              commit(relabelSpeaker(segments, mergeMenu.label, label));
              setExtraLabels((prev) => prev.filter((l) => l !== mergeMenu.label));
              setMergeMenu(null);
            }}
          >
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: speakerColor(label, order), mr: 1 }} />
            {nameOf(label)}
          </MenuItem>
        ))}
      </Menu>

      <Menu open={Boolean(exportMenu)} anchorEl={exportMenu} onClose={() => setExportMenu(null)}>
        {[
          ['Исправленная, метки', { names: false, source: 'edited' }],
          ['Исправленная, ФИО', { names: true, source: 'edited' }],
          ['Черновик модели', { names: false, source: 'auto' }],
        ].map(([label, opts]) => (
          <MenuItem
            key={label}
            component="a"
            href={voiceLabelingAPI.rttmUrl(projectId, opts)}
            onClick={() => setExportMenu(null)}
          >
            {label}
          </MenuItem>
        ))}
        {dirty && <MenuItem disabled>Сначала сохраните — выгружается сохранённая версия</MenuItem>}
      </Menu>
    </Stack>
  );
}

const pctOf = (t, total) => `${Math.min(100, Math.max(0, (t / total) * 100))}%`;

// Segment bars change only on edits; the playhead moves on every timeupdate.
const TimelineBars = memo(function TimelineBars({ segments, order, total, selectedId }) {
  return segments.map((seg) => {
    const isSelected = seg.id === selectedId;
    return (
      <div
        key={seg.id}
        style={{
          position: 'absolute',
          top: isSelected ? 0 : 4,
          bottom: isSelected ? 0 : 4,
          left: pctOf(seg.start, total),
          width: `max(1px, ${Math.max(0, ((seg.end - seg.start) / total) * 100)}%)`,
          background: speakerColor(seg.speaker, order),
          opacity: isSelected ? 1 : 0.8,
        }}
      />
    );
  });
});

function Timeline({ segments, order, duration, currentTime, selectedId, onSeek }) {
  const total = duration || (segments.length ? Math.max(...segments.map((s) => s.end)) : 0);
  if (!total) return null;
  return (
    <Box
      role="slider"
      aria-label="Шкала реплик"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(currentTime)}
      tabIndex={-1}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * total);
      }}
      sx={{ position: 'relative', height: 24, mt: 1, borderRadius: 1, bgcolor: 'action.hover', cursor: 'pointer', overflow: 'hidden' }}
    >
      <TimelineBars segments={segments} order={order} total={total} selectedId={selectedId} />
      <Box sx={{ position: 'absolute', top: 0, bottom: 0, width: 2, bgcolor: 'text.primary' }} style={{ left: pctOf(currentTime, total) }} />
    </Box>
  );
}

export default VoiceLabelEditor;
