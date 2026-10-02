import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import AddTaskOutlinedIcon from '@mui/icons-material/AddTaskOutlined';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { voiceJobsAPI } from '../../api/voiceJobs';
import { hubTaskSupportAPI } from '../../api/hubTaskSupport';
import { hubTasksAPI } from '../../api/hubTasks';

export const parseDeadline = (raw) => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(String(raw || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

// Локальная копия (не импортируем из drawer — избегаем цикла модулей).
const timecodeToSec = (raw) => {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(raw || ''));
  if (!m) return null;
  return m[3] != null
    ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    : Number(m[1]) * 60 + Number(m[2]);
};
// «0:MM:SS» → «M:SS» — без нулевого часа (P5-время): «0:01:00» → «1:00».
const fmtClock = (raw) => String(raw || '').replace(/^0+:(\d{1,2}):(\d{2})$/, (m, mm, ss) => `${Number(mm)}:${ss}`);

const errorDetailOr = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
};

function VoiceAssignmentsTab({ base, canCreateTasks = false, onCountChange, items: itemsProp, onSeekTime, currentSec = null }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [commentError, setCommentError] = useState('');
  const [taskDialog, setTaskDialog] = useState(null);
  const [assignee, setAssignee] = useState(null);
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [assigneeInput, setAssigneeInput] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState(null);
  const [clipPlayer, setClipPlayer] = useState(null);
  const [filter, setFilter] = useState('all');
  const [createdNums, setCreatedNums] = useState(() => new Set());
  const [statuses, setStatuses] = useState({});
  const [commentDialog, setCommentDialog] = useState(null); // { num, comment }
  const [rowMenu, setRowMenu] = useState(null); // { anchor, item }
  const clipMediaRef = useRef(null);
  const searchSeq = useRef(0);

  const isPriority = (task) => /‼|!\uFE0F|!\u203C/i.test(String(task || ''));
  const isDone = (num) => statuses[num]?.status === 'done';
  const isInProgress = (num) => statuses[num]?.status === 'in_progress';

  const closeClipPlayer = useCallback(() => {
    clipMediaRef.current?.pause?.();
    setClipPlayer(null);
  }, []);

  // items из родителя (drawer грузит поручения сразу при открытии карточки) —
  // тогда собственный запрос не нужен.
  useEffect(() => {
    if (itemsProp === undefined) return;
    setItems(itemsProp);
    onCountChange?.(itemsProp?.length ?? null);
  }, [itemsProp, onCountChange]);

  // T42: собственная загрузка выделена в функцию — «Повторить» на ошибке
  // вызывает её же, не ломая остальные блоки карточки.
  const loadItems = useCallback(() => {
    setError('');
    setItems(null);
    voiceJobsAPI.getAssignments(base)
      .then((data) => {
        const list = data.items || [];
        setItems(list);
        onCountChange?.(list.length);
      })
      .catch(() => { setItems([]); onCountChange?.(0); setError('Не удалось загрузить поручения'); });
  }, [base, onCountChange]);

  useEffect(() => {
    if (itemsProp === undefined) loadItems();
  }, [loadItems, itemsProp]);

  useEffect(() => {
    let cancelled = false;
    voiceJobsAPI.getAssignmentStatuses(base)
      .then((data) => {
        if (!cancelled) {
          const map = {};
          (data.items || []).forEach((s) => { map[s.num] = s; });
          setStatuses(map);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [base]);

  const toggleDone = async (num) => {
    const newStatus = isDone(num) ? 'pending' : 'done';
    setStatusError('');
    try {
      await voiceJobsAPI.updateAssignmentStatus(base, num, newStatus, statuses[num]?.comment || '');
      setStatuses((prev) => ({ ...prev, [num]: { ...prev[num], num, status: newStatus } }));
    } catch (err) {
      setStatusError(errorDetailOr(err, 'Не удалось изменить статус поручения'));
    }
  };

  const setInProgress = async (num) => {
    setStatusError('');
    try {
      await voiceJobsAPI.updateAssignmentStatus(base, num, 'in_progress', statuses[num]?.comment || '');
      setStatuses((prev) => ({ ...prev, [num]: { ...prev[num], num, status: 'in_progress' } }));
    } catch (err) {
      setStatusError(errorDetailOr(err, 'Не удалось изменить статус поручения'));
    }
  };

  const saveComment = async () => {
    if (!commentDialog) return;
    setCommentError('');
    try {
      await voiceJobsAPI.updateAssignmentStatus(base, commentDialog.num, statuses[commentDialog.num]?.status || 'pending', commentDialog.comment);
      setStatuses((prev) => ({ ...prev, [commentDialog.num]: { ...prev[commentDialog.num], num: commentDialog.num, comment: commentDialog.comment } }));
      setCommentDialog(null);
    } catch (err) {
      setCommentError(errorDetailOr(err, 'Не удалось сохранить комментарий'));
    }
  };

  useEffect(() => {
    if (!taskDialog) return undefined;
    const seq = ++searchSeq.current;
    const t = setTimeout(() => {
      hubTaskSupportAPI.getAssignees({ q: assigneeInput, limit: 100 })
        .then((data) => {
          if (seq === searchSeq.current) setAssigneeOptions(data.items || data || []);
        })
        .catch(() => { if (seq === searchSeq.current) setAssigneeOptions([]); });
    }, 300);
    return () => clearTimeout(t);
  }, [assigneeInput, taskDialog]);

  const openTaskDialog = useCallback((item) => {
    setTaskDialog(item);
    setTitle(item.task || '');
    setDueAt(parseDeadline(item.deadline));
    setAssignee(null);
    setAssigneeInput(item.assignee || '');
    setNotice(null);
  }, []);

  const submitTask = async () => {
    if (!taskDialog || !assignee || !title.trim() || creating) return;
    setCreating(true);
    try {
      await hubTasksAPI.createTask({
        title: title.trim(),
        description: [
          `Поручение №${taskDialog.num} из протокола «${base}», таймкод ${taskDialog.time}.`,
          taskDialog.clip ? `Фрагмент: /voice → ${base} → ${taskDialog.clip}` : '',
        ].filter(Boolean).join('\n'),
        assignee_user_ids: [assignee.id],
        due_at: dueAt || undefined,
        protocol_date: dueAt || undefined,
      });
      setNotice({
        text: `Задача «${title.trim()}» создана для ${assignee.full_name || assignee.username}`,
        severity: 'success',
      });
      setCreatedNums((prev) => new Set(prev).add(taskDialog.num));
      setTaskDialog(null);
    } catch (err) {
      setNotice({
        text: errorDetailOr(err, 'Не удалось создать задачу'),
        severity: 'error',
      });
    } finally {
      setCreating(false);
    }
  };

  if (items === null) {
    // T42: скелетоны строк вместо одиночного спиннера.
    return (
      <Stack spacing={1} aria-label="Загрузка поручений">
        {[0, 1, 2].map((i) => <Skeleton key={i} data-skeleton variant="rounded" height={56} />)}
      </Stack>
    );
  }
  if (error) {
    return (
      <Alert severity="error" action={<Button size="small" onClick={loadItems}>Повторить</Button>}>
        {error}
      </Alert>
    );
  }
  if (!items.length) {
    return <Alert severity="info">В отчёте нет реестра поручений.</Alert>;
  }

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (item) => {
    const d = parseDeadline(item.deadline);
    return Boolean(d && d < today) && !isDone(item.num);
  };
  // T41: статус поручения — чип с текстом, а не только цвет/мета-строка.
  const statusOf = (item) => {
    if (isDone(item.num)) return { label: 'Выполнено', color: 'success' };
    if (isOverdue(item)) return { label: 'Просрочено', color: 'error' };
    if (isInProgress(item.num)) return { label: 'В работе', color: 'primary' };
    return { label: 'Новое', color: 'default' };
  };
  const visible = items.filter((item) => {
    if (filter === 'noassignee') return !String(item.assignee || '').trim();
    if (filter === 'overdue') return isOverdue(item);
    if (filter === 'priority') return isPriority(item.task);
    if (filter === 'done') return isDone(item.num);
    if (filter === 'pending') return !isDone(item.num);
    return true;
  });
  // T41: разделы (section) — заголовки групп, порядок первого появления.
  const grouped = (() => {
    const map = new Map();
    visible.forEach((item) => {
      const key = String(item.section || '').trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return [...map.entries()];
  })();
  // T41: поручение, ближайшее к позиции плеера, подсвечивается.
  const nearestNum = currentSec == null ? null : (() => {
    let best = null; let bestDist = Infinity;
    items.forEach((item) => {
      const sec = timecodeToSec(item.time);
      if (sec == null) return;
      const d = Math.abs(sec - currentSec);
      if (d < bestDist) { bestDist = d; best = item.num; }
    });
    return best;
  })();

  return (
    <Box>
      {statusError && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setStatusError('')}>
          {statusError}
        </Alert>
      )}
      {notice?.severity === 'success' && (
        <Alert severity={notice.severity} sx={{ mb: 1.5 }} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      {/* T41: сводка — это сами чипы-фильтры со счётчиками (отдельной строки
          «Все/…» нет); порядок: всего → просрочено → без ответственного. */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
        <Chip
          aria-pressed={filter === 'all'}
          size="small"
          label={`Все (${items.length})`}
          variant={filter === 'all' ? 'filled' : 'outlined'}
          color={filter === 'all' ? 'primary' : 'default'}
          onClick={() => setFilter('all')}
        />
        <Chip
          aria-pressed={filter === 'overdue'}
          size="small"
          label={`Просроченные (${items.filter(isOverdue).length})`}
          variant={filter === 'overdue' ? 'filled' : 'outlined'}
          color={filter === 'overdue' ? 'error' : 'default'}
          onClick={() => setFilter('overdue')}
        />
        <Chip
          aria-pressed={filter === 'noassignee'}
          size="small"
          label={`Без ответственного (${items.filter((i) => !String(i.assignee || '').trim()).length})`}
          variant={filter === 'noassignee' ? 'filled' : 'outlined'}
          color={filter === 'noassignee' ? 'warning' : 'default'}
          onClick={() => setFilter('noassignee')}
        />
      </Stack>
      {!visible.length && <Alert severity="info">По фильтру поручений нет.</Alert>}
      {/* P4-1: компактный список вместо таблицы — всё помещается в узкую панель
          без горизонтальной прокрутки; действия собраны в меню «⋮» строки.
          T41: элементы группируются заголовками разделов (section). */}
      {grouped.map(([section, groupItems]) => (
        <Box key={section || '_'} sx={{ minWidth: 0 }}>
          {section && (
            <Typography
              variant="subtitle2"
              component="h3"
              color="text.secondary"
              sx={{ mt: 0.5, mb: 0.5, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: 0.3 }}
            >
              {section}
            </Typography>
          )}
          <Stack spacing={1} sx={{ minWidth: 0, mb: 1 }}>
        {groupItems.map((item) => (
          <Paper
            key={item.num}
            variant="outlined"
            data-assign-nearest={item.num === nearestNum ? '1' : undefined}
            sx={{
              p: 1, minWidth: 0,
              borderColor: item.num === nearestNum ? 'primary.main' : undefined,
              bgcolor: item.num === nearestNum ? 'action.selected' : undefined,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
              {item.clip || onSeekTime ? (
                // T30: таймкод перематывает основной плеер (onSeekTime);
                // без него — прежнее поведение: отдельный clip-диалог.
                <Chip
                  size="small"
                  clickable
                  label={fmtClock(item.time)}
                  aria-label={onSeekTime
                    ? `Перейти к ${fmtClock(item.time)} (поручение №${item.num})`
                    : `Фрагмент поручения №${item.num}, ${fmtClock(item.time)}`}
                  onClick={() => (onSeekTime
                    ? onSeekTime(item.time)
                    : setClipPlayer({ clip: item.clip, time: item.time, num: item.num }))}
                  sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', flexShrink: 0, mt: '1px' }}
                />
              ) : (
                <Typography variant="caption" sx={{ fontFamily: 'monospace', flexShrink: 0, pt: '4px' }}>
                  {fmtClock(item.time) || '—'}
                </Typography>
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  component="div"
                  title={item.task}
                  sx={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                  }}
                >
                  {isPriority(item.task) && (
                    <Chip size="small" color="error" label="Критично" sx={{ mr: 0.5, verticalAlign: '1px' }} />
                  )}
                  {item.task}
                </Typography>
                <Typography variant="caption" component="div" color="text.secondary" noWrap>
                  {/* P5-4: пустые поля (нет срока) не выводятся — без «—». */}
                  №{item.num} · {String(item.assignee || '').trim() || 'Без ответственного'}
                  {item.deadline ? ` · ${item.deadline}` : ''}
                  {' · '}
                  <Chip
                    size="small"
                    component="span"
                    color={statusOf(item).color}
                    variant={statusOf(item).color === 'default' ? 'outlined' : 'filled'}
                    label={statusOf(item).label}
                    sx={{ height: 18, fontSize: '0.68rem', verticalAlign: '1px', '& .MuiChip-label': { px: 0.5 } }}
                  />
                  {createdNums.has(item.num) ? ' · Задача создана' : ''}
                </Typography>
              </Box>
              <IconButton
                size="small"
                aria-label={`Действия с поручением №${item.num}`}
                onClick={(e) => setRowMenu({ anchor: e.currentTarget, item })}
                sx={{ flexShrink: 0, mt: -0.5 }}
              >
                <MoreVertOutlinedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Paper>
        ))}
          </Stack>
        </Box>
      ))}

      <Menu
        anchorEl={rowMenu?.anchor}
        open={Boolean(rowMenu)}
        onClose={() => setRowMenu(null)}
      >
        {rowMenu && [
          <MenuItem
            key="done"
            onClick={() => { const it = rowMenu.item; setRowMenu(null); toggleDone(it.num); }}
          >
            <ListItemIcon><TaskAltOutlinedIcon fontSize="small" color={isDone(rowMenu.item.num) ? 'success' : 'inherit'} /></ListItemIcon>
            {isDone(rowMenu.item.num)
              ? `Вернуть в работу (поручение №${rowMenu.item.num})`
              : `Отметить выполненным (поручение №${rowMenu.item.num})`}
          </MenuItem>,
          !isDone(rowMenu.item.num) && !isInProgress(rowMenu.item.num) && (
            <MenuItem
              key="progress"
              onClick={() => { const it = rowMenu.item; setRowMenu(null); setInProgress(it.num); }}
            >
              <ListItemIcon><PlayArrowOutlinedIcon fontSize="small" /></ListItemIcon>
              {`Взять в работу (поручение №${rowMenu.item.num})`}
            </MenuItem>
          ),
          <MenuItem
            key="comment"
            onClick={() => {
              const it = rowMenu.item;
              setCommentError('');
              setCommentDialog({ num: it.num, comment: statuses[it.num]?.comment || '' });
              setRowMenu(null);
            }}
          >
            <ListItemIcon><CommentOutlinedIcon fontSize="small" /></ListItemIcon>
            {`Комментарий (поручение №${rowMenu.item.num})`}
          </MenuItem>,
          canCreateTasks && !createdNums.has(rowMenu.item.num) && (
            <MenuItem
              key="task"
              onClick={() => { const it = rowMenu.item; setRowMenu(null); openTaskDialog(it); }}
            >
              <ListItemIcon><AddTaskOutlinedIcon fontSize="small" /></ListItemIcon>
              {`Создать задачу (поручение №${rowMenu.item.num})`}
            </MenuItem>
          ),
          rowMenu.item.clip && (
            <MenuItem
              key="clip"
              onClick={() => {
                const it = rowMenu.item;
                setRowMenu(null);
                setClipPlayer({ clip: it.clip, time: it.time, num: it.num });
              }}
            >
              <ListItemIcon><PlayArrowOutlinedIcon fontSize="small" /></ListItemIcon>
              {`Открыть фрагмент (поручение №${rowMenu.item.num})`}
            </MenuItem>
          ),
          rowMenu.item.clip && (
            <MenuItem
              key="download"
              component="a"
              href={voiceJobsAPI.clipUrl(base, rowMenu.item.clip)}
              download
              onClick={() => setRowMenu(null)}
            >
              <ListItemIcon><DownloadOutlinedIcon fontSize="small" /></ListItemIcon>
              {`Скачать фрагмент (поручение №${rowMenu.item.num})`}
            </MenuItem>
          ),
        ]}
      </Menu>

      <Dialog open={Boolean(clipPlayer)} onClose={closeClipPlayer} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          Фрагмент поручения №{clipPlayer?.num}
          <IconButton aria-label="Закрыть плеер" onClick={closeClipPlayer} sx={{ position: 'absolute', right: 8, top: 8 }}>
            <CloseOutlinedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontFamily: 'monospace' }}>
            {clipPlayer?.time}
          </Typography>
          {clipPlayer && (String(clipPlayer.clip).toLowerCase().endsWith('.mp4') ? (
            <video
              ref={clipMediaRef}
              controls
              autoPlay
              src={voiceJobsAPI.clipUrl(base, clipPlayer.clip)}
              style={{ width: '100%', maxHeight: 320, background: '#000' }}
              onEnded={closeClipPlayer}
            />
          ) : (
            <audio
              ref={clipMediaRef}
              controls
              autoPlay
              src={voiceJobsAPI.clipUrl(base, clipPlayer.clip)}
              style={{ width: '100%' }}
              onEnded={closeClipPlayer}
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeClipPlayer}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* Comment dialog */}
      <Dialog open={Boolean(commentDialog)} onClose={() => setCommentDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Комментарий к поручению {commentDialog?.num}</DialogTitle>
        <DialogContent>
          {commentError && <Alert severity="error" sx={{ mb: 2 }}>{commentError}</Alert>}
          <TextField
            fullWidth
            multiline
            minRows={3}
            value={commentDialog?.comment || ''}
            onChange={(e) => setCommentDialog((prev) => ({ ...prev, comment: e.target.value }))}
            placeholder="Статус, что сделано, что осталось..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCommentDialog(null)}>Отмена</Button>
          <Button variant="contained" onClick={saveComment}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(taskDialog)} onClose={creating ? undefined : () => setTaskDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Задача из поручения №{taskDialog?.num}</DialogTitle>
        <DialogContent dividers>
          {notice?.severity === 'error' && <Alert severity={notice.severity} sx={{ mb: 2 }}>{notice.text}</Alert>}
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <TextField
              label="Название задачи"
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Autocomplete
              size="small"
              options={assigneeOptions}
              value={assignee}
              inputValue={assigneeInput}
              onInputChange={(_e, v) => setAssigneeInput(v)}
              onChange={(_e, v) => setAssignee(v)}
              getOptionLabel={(o) => (typeof o === 'string' ? o : (o.full_name || o.username || ''))}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              filterOptions={(x) => x}
              renderInput={(params) => (
                <TextField {...params} label="Исполнитель" placeholder="Начните вводить имя" required />
              )}
            />
            <TextField
              label="Срок"
              type="date"
              size="small"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              helperText={taskDialog?.deadline && !parseDeadline(taskDialog.deadline)
                ? `В реестре: ${taskDialog.deadline} — выберите дату вручную`
                : undefined}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTaskDialog(null)} disabled={creating}>Отмена</Button>
          <Button variant="contained" onClick={submitTask} disabled={!assignee || !title.trim() || creating}>
            {creating ? 'Создаю…' : 'Создать задачу'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default VoiceAssignmentsTab;
