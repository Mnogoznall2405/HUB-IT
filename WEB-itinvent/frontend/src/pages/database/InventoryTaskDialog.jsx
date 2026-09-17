import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import hubTasksAPI from '../../api/hubTasks';
import hubTaskSupportAPI from '../../api/hubTaskSupport';
import {
  filterTaskUserOptions,
  getTaskUserLabel,
} from '../tasks/taskUserUtils';

const getProjectLabel = (project) => String(project?.name || project?.code || project?.id || '').trim();

/**
 * Compact "create inventory task" dialog: title + discrepancy description are
 * prefilled, user picks assignee and project.
 */
export default function InventoryTaskDialog({
  open,
  employeeName,
  description,
  onClose,
  onOpenTasks,
}) {
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [projectOptions, setProjectOptions] = useState([]);
  const [assignee, setAssignee] = useState(null);
  const [project, setProject] = useState(null);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdTaskId, setCreatedTaskId] = useState('');
  const searchSeqRef = useRef(0);

  const loadAssignees = useCallback(async (query = '') => {
    const seq = ++searchSeqRef.current;
    try {
      const payload = await hubTaskSupportAPI.getAssignees({ q: query, limit: 30 });
      if (searchSeqRef.current !== seq) return;
      setAssigneeOptions(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      if (searchSeqRef.current === seq) {
        console.warn('Failed to load task assignees:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTitle(`Инвентаризация расхождений — ${employeeName || 'сотрудник'}`);
    setAssignee(null);
    setDueAt('');
    setError('');
    setCreatedTaskId('');
    setOptionsLoading(true);
    void loadAssignees('');
    let cancelled = false;
    hubTaskSupportAPI.getTaskProjects({ limit: 50 })
      .then((payload) => {
        if (cancelled) return;
        const projects = Array.isArray(payload?.items)
          ? payload.items
          : (Array.isArray(payload) ? payload : []);
        setProjectOptions(projects);
        const general = projects.find((item) => (
          String(item?.id || '') === 'general-tasks'
          || String(item?.code || '').trim().toUpperCase() === 'GENERAL'
          || String(item?.name || '').trim().toLowerCase() === 'общие задачи'
        ));
        setProject(general || projects[0] || null);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Failed to load task projects:', err);
          setError('Не удалось загрузить список проектов задач.');
        }
      })
      .finally(() => { if (!cancelled) setOptionsLoading(false); });
    return () => { cancelled = true; };
  }, [open, employeeName, loadAssignees]);

  const canSubmit = title.trim().length >= 3 && assignee && project && !saving;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const response = await hubTasksAPI.createTask({
        title: title.trim(),
        description: String(description || '').trim(),
        checklist_items: [],
        assignee_user_ids: [Number(assignee.id)].filter(Number.isInteger),
        controller_user_id: null,
        project_id: String(project.id || '').trim(),
        object_id: null,
        protocol_date: new Date().toISOString().slice(0, 10),
        due_at: dueAt || null,
        priority: 'normal',
        department_id: null,
        visibility_scope: 'private',
        observer_user_ids: [],
      });
      const createdId = String(response?.task?.id || response?.id || response?.task_id || '').trim();
      setCreatedTaskId(createdId || 'created');
    } catch (err) {
      console.error('Failed to create inventory task:', err);
      setError(err?.response?.data?.detail || err?.message || 'Не удалось создать задачу.');
    } finally {
      setSaving(false);
    }
  }, [canSubmit, title, description, assignee, project, dueAt]);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        Задача на инвентаризацию
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          disabled={saving}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {createdTaskId ? (
          <Alert severity="success" sx={{ mb: 1 }}>
            Задача создана. Список расхождений вложен в описание.
          </Alert>
        ) : (
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField
              size="small"
              label="Название"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              fullWidth
            />
            <Autocomplete
              size="small"
              options={assigneeOptions}
              value={assignee}
              onChange={(_event, value) => setAssignee(value)}
              onInputChange={(_event, value, reason) => {
                if (reason === 'input' && value.trim().length >= 2) void loadAssignees(value);
              }}
              getOptionLabel={getTaskUserLabel}
              filterOptions={filterTaskUserOptions}
              isOptionEqualToValue={(option, value) => String(option?.id) === String(value?.id)}
              loading={optionsLoading}
              renderInput={(params) => (
                <TextField {...params} label="Исполнитель" placeholder="Начните вводить ФИО" />
              )}
              noOptionsText="Никого не найдено"
            />
            <Autocomplete
              size="small"
              options={projectOptions}
              value={project}
              onChange={(_event, value) => setProject(value)}
              getOptionLabel={getProjectLabel}
              isOptionEqualToValue={(option, value) => String(option?.id) === String(value?.id)}
              loading={optionsLoading}
              renderInput={(params) => <TextField {...params} label="Проект" />}
              noOptionsText="Проектов нет"
            />
            <TextField
              type="date"
              size="small"
              label="Срок"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Typography variant="caption" color="text.secondary">
              В описание попадёт текст сверки: совпадающие по парт. № расхождения, позиции только
              в Хабе и только в 1С.
            </Typography>
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {createdTaskId ? (
          <>
            {onOpenTasks ? <Button onClick={onOpenTasks}>К задачам</Button> : null}
            <Button variant="contained" onClick={onClose}>Готово</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={saving}>Отмена</Button>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={!canSubmit}
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {saving ? 'Создаю…' : 'Создать задачу'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
