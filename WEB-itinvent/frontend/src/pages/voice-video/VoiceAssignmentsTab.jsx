import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import { voiceJobsAPI } from '../../api/voiceJobs';
import { hubTaskSupportAPI } from '../../api/hubTaskSupport';
import { hubTasksAPI } from '../../api/hubTasks';

export const parseDeadline = (raw) => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(String(raw || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

function VoiceAssignmentsTab({ base, canCreateTasks = false, onCountChange }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [taskDialog, setTaskDialog] = useState(null);
  const [assignee, setAssignee] = useState(null);
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [assigneeInput, setAssigneeInput] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [clipPlayer, setClipPlayer] = useState(null);
  const [filter, setFilter] = useState('all');
  const [createdNums, setCreatedNums] = useState(() => new Set());
  const [statuses, setStatuses] = useState({});
  const [commentDialog, setCommentDialog] = useState(null); // { num, comment }
  const clipMediaRef = useRef(null);
  const searchSeq = useRef(0);

  const isPriority = (task) => /‼|!\uFE0F|!\u203C/i.test(String(task || ''));
  const isDone = (num) => statuses[num]?.status === 'done';
  const isInProgress = (num) => statuses[num]?.status === 'in_progress';

  const closeClipPlayer = useCallback(() => {
    clipMediaRef.current?.pause?.();
    setClipPlayer(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    voiceJobsAPI.getAssignments(base)
      .then((data) => {
        if (!cancelled) {
          const list = data.items || [];
          setItems(list);
          onCountChange?.(list.length);
        }
      })
      .catch(() => { if (!cancelled) { setItems([]); onCountChange?.(0); setError('Не удалось загрузить поручения'); } });
    return () => { cancelled = true; };
  }, [base, onCountChange]);

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
    try {
      await voiceJobsAPI.updateAssignmentStatus(base, num, newStatus, statuses[num]?.comment || '');
      setStatuses((prev) => ({ ...prev, [num]: { ...prev[num], num, status: newStatus } }));
    } catch { /* silent */ }
  };

  const setInProgress = async (num) => {
    try {
      await voiceJobsAPI.updateAssignmentStatus(base, num, 'in_progress', statuses[num]?.comment || '');
      setStatuses((prev) => ({ ...prev, [num]: { ...prev[num], num, status: 'in_progress' } }));
    } catch { /* silent */ }
  };

  const saveComment = async () => {
    if (!commentDialog) return;
    try {
      await voiceJobsAPI.updateAssignmentStatus(base, commentDialog.num, statuses[commentDialog.num]?.status || 'pending', commentDialog.comment);
      setStatuses((prev) => ({ ...prev, [commentDialog.num]: { ...prev[commentDialog.num], num: commentDialog.num, comment: commentDialog.comment } }));
      setCommentDialog(null);
    } catch { /* silent */ }
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
    setNotice('');
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
      setNotice(`Задача «${title.trim()}» создана для ${assignee.full_name || assignee.username}`);
      setCreatedNums((prev) => new Set(prev).add(taskDialog.num));
      setTaskDialog(null);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setNotice(typeof detail === 'string' ? `Не удалось создать задачу: ${detail}` : 'Не удалось создать задачу');
    } finally {
      setCreating(false);
    }
  };

  if (items === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>;
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!items.length) {
    return <Alert severity="info">В отчёте нет реестра поручений.</Alert>;
  }

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (item) => {
    const d = parseDeadline(item.deadline);
    return Boolean(d && d < today);
  };
  const visible = items.filter((item) => {
    if (filter === 'noassignee') return !String(item.assignee || '').trim();
    if (filter === 'overdue') return isOverdue(item);
    if (filter === 'priority') return isPriority(item.task);
    if (filter === 'done') return isDone(item.num);
    if (filter === 'pending') return !isDone(item.num);
    return true;
  });

  return (
    <Box>
      {notice && (
        <Alert severity={notice.startsWith('Не удалось') ? 'error' : 'success'} sx={{ mb: 1.5 }} onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
        <Chip size="small" label={`Все (${items.length})`} variant={filter === 'all' ? 'filled' : 'outlined'} color={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')} />
        <Chip size="small" label={`Без ответственного (${items.filter((i) => !String(i.assignee || '').trim()).length})`} variant={filter === 'noassignee' ? 'filled' : 'outlined'} color={filter === 'noassignee' ? 'warning' : 'default'} onClick={() => setFilter('noassignee')} />
        <Chip size="small" label={`Просроченные (${items.filter(isOverdue).length})`} variant={filter === 'overdue' ? 'filled' : 'outlined'} color={filter === 'overdue' ? 'error' : 'default'} onClick={() => setFilter('overdue')} />
      </Stack>
      {!visible.length && <Alert severity="info">По фильтру поручений нет.</Alert>}
      <TableContainer component={Paper} variant="outlined" sx={{ display: visible.length ? 'block' : 'none' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }}>№</TableCell>
              <TableCell sx={{ width: 70 }}>Время</TableCell>
              <TableCell>Поручение</TableCell>
              <TableCell>Ответственный</TableCell>
              <TableCell>Срок</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((item) => (
              <TableRow key={item.num} hover>
                <TableCell>{item.num}</TableCell>
                <TableCell>
                  {item.clip ? (
                    <Chip
                      size="small"
                      clickable
                      label={item.time}
                      onClick={() => setClipPlayer({ clip: item.clip, time: item.time, num: item.num })}
                      sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}
                    />
                  ) : (
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{item.time || '—'}</Typography>
                  )}
                </TableCell>
                <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                        {isPriority(item.task) && <Chip size="small" color="error" label="Критично" />}
                        {isDone(item.num) && <Chip size="small" color="success" label="Выполнено" />}
                        {isInProgress(item.num) && <Chip size="small" color="info" label="В работе" />}
                        <Typography variant="body2">{item.task}</Typography>
                      </Stack>
                    </TableCell>
                <TableCell><Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>{item.assignee || '—'}</Typography></TableCell>
                <TableCell>
                  <Typography variant="caption" noWrap color={isOverdue(item) ? 'error' : 'text.primary'}>
                    {item.deadline || '—'}{isOverdue(item) ? ' (просрочено)' : ''}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title={isDone(item.num) ? "Вернуть в работу" : "Отметить выполненным"}>
                        <IconButton size="small" color={isDone(item.num) ? "success" : "default"} onClick={() => toggleDone(item.num)}>
                          <TaskAltOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {!isDone(item.num) && !isInProgress(item.num) && (
                        <Tooltip title="Взять в работу">
                          <IconButton size="small" onClick={() => setInProgress(item.num)}>
                            <PlayArrowOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Комментарий">
                        <IconButton size="small" onClick={() => setCommentDialog({ num: item.num, comment: statuses[item.num]?.comment || "" })}>
                          <CommentOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {canCreateTasks && !createdNums.has(item.num) && (
                        <Tooltip title="Создать задачу">
                          <IconButton size="small" onClick={() => openTaskDialog(item)}>
                            <TaskAltOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {createdNums.has(item.num) && (
                        <Chip size="small" color="success" variant="outlined" label="Создана" />
                      )}
                    </Stack>
                  </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

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
