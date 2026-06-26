import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import MarkdownEditor from './MarkdownEditor';
import CreateDuePickerPanel from './CreateDuePickerPanel';
import { getOfficeDialogPaperSx, getOfficeHeaderBandSx } from '../../theme/officeUiTokens';
import { hubAPI } from '../../api/client';
import useDebounce from '../../hooks/useDebounce';
import { mergeTaskAssigneeOptions, TASK_ASSIGNEE_SEARCH_MIN_CHARS } from '../../hooks/useTaskAssigneeDirectory';
import { buildCreateDuePresets } from '../../pages/tasksViewModel';

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Низкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'high', label: 'Высокий' },
  { value: 'urgent', label: 'Срочный' },
];

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Только участники' },
  { value: 'department', label: 'Отдел' },
  { value: 'department_managers', label: 'Руководители отдела' },
  { value: 'global', label: 'Все пользователи' },
];

const toDateInput = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const toDateTimeInput = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60_000));
  return local.toISOString().slice(0, 16);
};

const userLabel = (item) => String(item?.full_name || item?.username || '').trim();
const departmentLabel = (item) => String(item?.name || item?.department_name || '').trim();
const userInitials = (item) => {
  const label = userLabel(item);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  return label.slice(0, 2).toUpperCase();
};

export function TaskEditDialog({
  open,
  task,
  references,
  referencesLoading = false,
  saving = false,
  onClose,
  onSave,
  ui,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [draft, setDraft] = useState({});
  const [assigneeSearchInput, setAssigneeSearchInput] = useState('');
  const debouncedAssigneeSearchInput = useDebounce(assigneeSearchInput, 300);
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [assigneeLoading, setAssigneeLoading] = useState(false);
  const [assigneeSearchError, setAssigneeSearchError] = useState('');
  const [observerOptions, setObserverOptions] = useState([]);
  const [observerSearchInput, setObserverSearchInput] = useState('');
  const debouncedObserverSearchInput = useDebounce(observerSearchInput, 300);
  const [observerLoading, setObserverLoading] = useState(false);
  const [observerSearchError, setObserverSearchError] = useState('');

  useEffect(() => {
    if (!open || !task) return;
    const assigneeId = String(task.assignee_user_id || '').trim();
    setDraft({
      title: String(task.title || ''),
      description: String(task.description || ''),
      assignee_user_id: assigneeId,
      controller_user_id: String(task.controller_user_id || ''),
      observer_user_ids: (Array.isArray(task.observer_user_ids) ? task.observer_user_ids : [])
        .map((value) => String(value || ''))
        .filter(Boolean),
      department_id: String(task.department_id || ''),
      visibility_scope: String(task.visibility_scope || 'private'),
      project_id: String(task.project_id || ''),
      object_id: String(task.object_id || ''),
      protocol_date: toDateInput(task.protocol_date),
      due_at: toDateTimeInput(task.due_at),
      priority: String(task.priority || 'normal'),
    });
    if (assigneeId) {
      const assigneeSnapshot = {
        id: assigneeId,
        full_name: String(task.assignee_full_name || '').trim(),
        username: String(task.assignee_username || '').trim(),
      };
      setAssigneeOptions(mergeTaskAssigneeOptions([], [assigneeSnapshot]));
      setAssigneeSearchInput(userLabel(assigneeSnapshot));
    } else {
      setAssigneeOptions([]);
      setAssigneeSearchInput('');
    }
    const observerSnapshots = (Array.isArray(task.observers) ? task.observers : [])
      .map((item) => ({
        id: String(item?.user_id || ''),
        full_name: String(item?.full_name || '').trim(),
        username: String(item?.username || '').trim(),
      }))
      .filter((item) => item.id);
    setObserverOptions(mergeTaskAssigneeOptions([], observerSnapshots));
    setObserverSearchInput('');
  }, [open, task]);

  const resolveAssigneeById = useCallback(async (assigneeId) => {
    const normalizedId = String(assigneeId || '').trim();
    if (!normalizedId) return null;
    try {
      const payload = await hubAPI.getAssignees({ ids: normalizedId });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      return items.find((item) => String(item?.id || '') === normalizedId) || items[0] || null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void resolveAssigneeById(draft.assignee_user_id).then((item) => {
      if (!cancelled && item) {
        setAssigneeOptions((prev) => mergeTaskAssigneeOptions(prev, [item]));
        setAssigneeSearchInput((prev) => (String(prev || '').trim() ? prev : userLabel(item)));
      }
    });
    return () => { cancelled = true; };
  }, [draft.assignee_user_id, open, resolveAssigneeById]);

  useEffect(() => {
    if (!open) return;
    const normalizedQuery = String(debouncedAssigneeSearchInput || '').trim();
    if (normalizedQuery.length < TASK_ASSIGNEE_SEARCH_MIN_CHARS) {
      setAssigneeSearchError('');
      return undefined;
    }

    let cancelled = false;
    setAssigneeLoading(true);
    setAssigneeSearchError('');
    void hubAPI.getAssignees({ q: normalizedQuery, limit: 30 })
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setAssigneeOptions((prev) => mergeTaskAssigneeOptions(
          prev.filter((item) => String(item?.id || '') === String(draft.assignee_user_id || '')),
          items,
        ));
      })
      .catch((error) => {
        if (cancelled) return;
        setAssigneeSearchError(String(error?.response?.data?.detail || error?.message || 'Не удалось найти исполнителей'));
      })
      .finally(() => {
        if (!cancelled) setAssigneeLoading(false);
      });

    return () => { cancelled = true; };
  }, [debouncedAssigneeSearchInput, draft.assignee_user_id, open]);

  useEffect(() => {
    if (!open) return;
    const normalizedQuery = String(debouncedObserverSearchInput || '').trim();
    if (normalizedQuery.length < TASK_ASSIGNEE_SEARCH_MIN_CHARS) {
      setObserverSearchError('');
      return undefined;
    }

    let cancelled = false;
    setObserverLoading(true);
    setObserverSearchError('');
    void hubAPI.getAssignees({ q: normalizedQuery, limit: 30 })
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const selectedIds = new Set(
          (Array.isArray(draft.observer_user_ids) ? draft.observer_user_ids : []).map((item) => String(item || '')),
        );
        setObserverOptions((prev) => mergeTaskAssigneeOptions(
          prev.filter((item) => selectedIds.has(String(item?.id || ''))),
          items,
        ));
      })
      .catch((error) => {
        if (cancelled) return;
        setObserverSearchError(String(error?.response?.data?.detail || error?.message || 'Не удалось найти наблюдателей'));
      })
      .finally(() => {
        if (!cancelled) setObserverLoading(false);
      });

    return () => { cancelled = true; };
  }, [debouncedObserverSearchInput, draft.observer_user_ids, open]);

  const controllers = references?.controllers || [];
  const departments = references?.departments || [];
  const projects = references?.projects || [];
  const objects = references?.objects || [];
  const selectedAssignee = assigneeOptions.find((item) => String(item?.id || '') === draft.assignee_user_id) || null;
  const selectedController = controllers.find((item) => String(item?.id || '') === draft.controller_user_id) || null;
  const selectedObservers = (Array.isArray(draft.observer_user_ids) ? draft.observer_user_ids : [])
    .map((id) => observerOptions.find((item) => String(item?.id || '') === String(id || '')) || { id, full_name: '', username: '' })
    .filter((item) => String(item?.id || '').trim());
  const selectedDepartment = departments.find((item) => String(item?.id || '') === draft.department_id) || null;
  const activeProjects = projects.filter((item) => item?.is_active !== false || String(item?.id || '') === draft.project_id);
  const projectObjects = objects.filter((item) => (
    String(item?.project_id || '') === draft.project_id
    && (item?.is_active !== false || String(item?.id || '') === draft.object_id)
  ));

  const submit = () => onSave?.({
    title: String(draft.title || '').trim(),
    description: String(draft.description || '').trim(),
    assignee_user_id: Number(draft.assignee_user_id || 0) || null,
    controller_user_id: Number(draft.controller_user_id || 0) || null,
    observer_user_ids: (Array.isArray(draft.observer_user_ids) ? draft.observer_user_ids : [])
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0),
    department_id: String(draft.department_id || '').trim() || null,
    visibility_scope: String(draft.visibility_scope || 'private').trim() || 'private',
    project_id: String(draft.project_id || '').trim() || null,
    object_id: String(draft.object_id || '').trim() || null,
    protocol_date: String(draft.protocol_date || '').trim() || null,
    due_at: String(draft.due_at || '').trim() || null,
    priority: String(draft.priority || 'normal'),
  });

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md" fullScreen={fullScreen} PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}>
      <Box sx={getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 })}>
        <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Редактирование задачи</Typography>
        <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
          Изменения сразу синхронизируются с карточкой задачи и её чатом.
        </Typography>
      </Box>
      <DialogContent sx={{ px: 2.2, py: 1.6 }}>
        <Stack spacing={1.5}>
          <TextField
            label="Заголовок"
            value={draft.title || ''}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            fullWidth
            required
          />
          <MarkdownEditor
            label="Описание"
            value={draft.description || ''}
            onChange={(description) => setDraft((current) => ({ ...current, description }))}
            minRows={6}
            visualVariant="taskDialog"
          />
          <Grid container spacing={1.2}>
            <Grid item xs={12} md={6}>
              <Autocomplete
                fullWidth
                size="small"
                loading={referencesLoading || assigneeLoading}
                options={mergeTaskAssigneeOptions(selectedAssignee, assigneeOptions)}
                value={selectedAssignee}
                onChange={(_, value) => {
                  setDraft((current) => ({ ...current, assignee_user_id: String(value?.id || '') }));
                  setAssigneeSearchInput(value ? userLabel(value) : '');
                  setAssigneeOptions((prev) => mergeTaskAssigneeOptions(value, prev));
                }}
                inputValue={
                  String(assigneeSearchInput || '').trim()
                    ? assigneeSearchInput
                    : (selectedAssignee ? userLabel(selectedAssignee) : '')
                }
                clearOnBlur={false}
                onInputChange={(_, value, reason) => {
                  if (reason === 'input') {
                    setAssigneeSearchInput(value);
                    return;
                  }
                  if (reason === 'clear') {
                    setAssigneeSearchInput('');
                  }
                }}
                getOptionLabel={userLabel}
                filterOptions={(options) => options}
                isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
                noOptionsText={
                  String(assigneeSearchInput || '').trim().length < TASK_ASSIGNEE_SEARCH_MIN_CHARS
                    ? 'Введите фамилию или логин'
                    : (assigneeSearchError || 'Ничего не найдено')
                }
                renderInput={(params) => <TextField {...params} label="Исполнитель" placeholder="Фамилия или логин" />}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                fullWidth
                size="small"
                loading={referencesLoading}
                options={controllers}
                value={selectedController}
                onChange={(_, value) => setDraft((current) => ({ ...current, controller_user_id: String(value?.id || '') }))}
                getOptionLabel={userLabel}
                isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
                renderInput={(params) => <TextField {...params} label="Контролёр" />}
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                fullWidth
                multiple
                size="small"
                loading={assigneeLoading || observerLoading}
                options={mergeTaskAssigneeOptions(selectedObservers, observerOptions)}
                value={selectedObservers}
                onChange={(_, value) => {
                  const nextIds = Array.isArray(value)
                    ? value.map((item) => String(item?.id || '')).filter(Boolean)
                    : [];
                  setDraft((current) => ({ ...current, observer_user_ids: nextIds }));
                  setObserverOptions((prev) => mergeTaskAssigneeOptions(prev, Array.isArray(value) ? value : []));
                }}
                inputValue={observerSearchInput}
                onInputChange={(_, value, reason) => {
                  if (reason === 'input' || reason === 'clear') setObserverSearchInput(value);
                }}
                getOptionLabel={userLabel}
                filterOptions={(options) => options}
                isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
                disableCloseOnSelect
                noOptionsText={
                  String(observerSearchInput || '').trim().length < TASK_ASSIGNEE_SEARCH_MIN_CHARS
                    ? 'Введите фамилию или логин'
                    : (observerSearchError || 'Ничего не найдено')
                }
                renderTags={(value, getTagProps) => value.map((option, index) => {
                  const { key, ...tagProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      {...tagProps}
                      icon={<VisibilityOutlinedIcon sx={{ fontSize: '0.95rem !important' }} />}
                      avatar={<Avatar sx={{ width: 22, height: 22, fontSize: '0.62rem' }}>{userInitials(option)}</Avatar>}
                      label={userLabel(option)}
                      size="small"
                      color="secondary"
                      variant="outlined"
                    />
                  );
                })}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Наблюдатели"
                    placeholder="Фамилия или логин"
                    helperText="Наблюдатели видят задачу и могут писать в чат"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                fullWidth
                size="small"
                loading={referencesLoading}
                options={departments}
                value={selectedDepartment}
                onChange={(_, value) => setDraft((current) => ({
                  ...current,
                  department_id: String(value?.id || ''),
                  visibility_scope: value?.id ? (current.visibility_scope || 'department') : 'private',
                }))}
                getOptionLabel={departmentLabel}
                isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
                renderInput={(params) => <TextField {...params} label="Отдел" />}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size="small">
                <InputLabel id="workspace-edit-visibility-label">Видимость</InputLabel>
                <Select
                  labelId="workspace-edit-visibility-label"
                  label="Видимость"
                  value={draft.visibility_scope || 'private'}
                  onChange={(event) => setDraft((current) => ({ ...current, visibility_scope: event.target.value }))}
                >
                  {VISIBILITY_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel id="workspace-edit-project-label">Проект</InputLabel>
                <Select
                  labelId="workspace-edit-project-label"
                  label="Проект"
                  value={draft.project_id || ''}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    project_id: String(event.target.value || ''),
                    object_id: '',
                  }))}
                >
                  {activeProjects.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel id="workspace-edit-object-label">Объект</InputLabel>
                <Select
                  labelId="workspace-edit-object-label"
                  label="Объект"
                  value={draft.object_id || ''}
                  disabled={!draft.project_id}
                  onChange={(event) => setDraft((current) => ({ ...current, object_id: String(event.target.value || '') }))}
                >
                  <MenuItem value="">Без объекта</MenuItem>
                  {projectObjects.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Дата постановки"
                type="date"
                value={draft.protocol_date || ''}
                onChange={(event) => setDraft((current) => ({ ...current, protocol_date: event.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Срок"
                type="datetime-local"
                value={draft.due_at || ''}
                onChange={(event) => setDraft((current) => ({ ...current, due_at: event.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size="small">
                <InputLabel id="workspace-edit-priority-label">Приоритет</InputLabel>
                <Select
                  labelId="workspace-edit-priority-label"
                  label="Приоритет"
                  value={draft.priority || 'normal'}
                  onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}
                >
                  {PRIORITY_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
        <Button onClick={onClose} disabled={saving}>Отмена</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={saving || String(draft.title || '').trim().length < 3 || referencesLoading}
          sx={{ fontWeight: 800, boxShadow: 'none' }}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function TaskReviewDialog({ task, open, saving = false, onClose, onSubmit, ui }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [comment, setComment] = useState('');
  useEffect(() => {
    if (open) setComment('');
  }, [open, task?.id]);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}>
      <Box sx={getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 })}>
        <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Проверка задачи</Typography>
      </Box>
      <DialogContent sx={{ px: 2.2, py: 1.6 }}>
        <Stack spacing={1.2}>
          <Typography sx={{ fontWeight: 700 }}>{task?.title || '-'}</Typography>
          <TextField label="Комментарий проверки" value={comment} onChange={(event) => setComment(event.target.value)} multiline minRows={3} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
        <Button onClick={onClose} disabled={saving}>Отмена</Button>
        <Button variant="outlined" color="warning" onClick={() => onSubmit?.('reject', comment)} disabled={saving}>Вернуть</Button>
        <Button variant="contained" color="success" onClick={() => onSubmit?.('approve', comment)} disabled={saving} sx={{ boxShadow: 'none' }}>Принять</Button>
      </DialogActions>
    </Dialog>
  );
}

export function TaskSubmitDialog({ task, open, saving = false, onClose, onSubmit, ui }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [comment, setComment] = useState('');
  const [file, setFile] = useState(null);

  useEffect(() => {
    if (!open) return;
    setComment('');
    setFile(null);
  }, [open, task?.id]);

  const fileLabel = useMemo(() => file?.name || 'Прикрепить файл', [file]);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}>
      <Box sx={getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 })}>
        <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Сдать работу</Typography>
      </Box>
      <DialogContent sx={{ px: 2.2, py: 1.6 }}>
        <Stack spacing={1.2}>
          <Typography sx={{ fontWeight: 700 }}>{task?.title || '-'}</Typography>
          <TextField label="Комментарий к сдаче" value={comment} onChange={(event) => setComment(event.target.value)} multiline minRows={3} fullWidth />
          <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />} sx={{ alignSelf: 'flex-start' }}>
            {fileLabel}
            <input type="file" hidden onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
        <Button onClick={onClose} disabled={saving}>Отмена</Button>
        <Button variant="contained" onClick={() => onSubmit?.({ comment, file })} disabled={saving} sx={{ fontWeight: 800, boxShadow: 'none' }}>
          {saving ? 'Отправка...' : 'Сдать'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function TaskReopenDialog({
  task,
  open,
  saving = false,
  onClose,
  onSubmit,
  ui,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [dueAt, setDueAt] = useState('');
  const [customDueOpen, setCustomDueOpen] = useState(false);
  const duePresets = useMemo(() => buildCreateDuePresets(new Date()), [open, task?.id]);

  useEffect(() => {
    if (!open) return;
    setDueAt(toDateTimeInput(task?.due_at));
    setCustomDueOpen(false);
  }, [open, task?.id, task?.due_at]);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}>
      <Box sx={getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 })}>
        <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Вернуть в работу</Typography>
        <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
          Укажите новый крайний срок — участники получат уведомление на почту.
        </Typography>
      </Box>
      <DialogContent sx={{ px: 0, py: 0 }}>
        <Stack spacing={0}>
          <Box sx={{ px: 2.2, pt: 1.2, pb: 0.4 }}>
            <Typography sx={{ fontWeight: 700 }}>{task?.title || '-'}</Typography>
          </Box>
          <CreateDuePickerPanel
            presets={duePresets}
            dueAt={dueAt}
            customOpen={customDueOpen}
            onCustomOpenChange={setCustomDueOpen}
            onSelectPreset={(preset) => {
              setDueAt(preset?.value || '');
              setCustomDueOpen(false);
            }}
            onDueAtChange={setDueAt}
            onClose={() => setCustomDueOpen(false)}
            testIdPrefix="reopen-due"
            title="Новый крайний срок"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
        <Button onClick={onClose} disabled={saving}>Отмена</Button>
        <Button
          variant="contained"
          onClick={() => onSubmit?.({ due_at: String(dueAt || '').trim() || null })}
          disabled={saving}
          sx={{ fontWeight: 800, boxShadow: 'none' }}
        >
          {saving ? 'Возврат...' : 'Вернуть в работу'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
