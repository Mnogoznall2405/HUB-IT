import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import AddTaskOutlinedIcon from '@mui/icons-material/AddTaskOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import MainLayout from '../components/layout/MainLayout';
import MobileShellPageHeader from '../components/layout/MobileShellPageHeader';
import PageShell from '../components/layout/PageShell';
import { docflowAPI } from '../api/docflow';
import {
  buildAttachmentBlobPayload,
  buildAttachmentPreviewState,
  createEmptyAttachmentPreview,
  downloadBlobFile,
  getOfficeAttachmentSourceKind,
  MAX_PREVIEW_FILE_BYTES,
} from '../components/mail/mailMessageFileActions';
import {
  DocflowTaskCard,
  DocflowTaskDetails,
  formatDocflowFileSize,
} from './docflow/DocflowTaskSurface';


const MailAttachmentPreviewDialog = lazy(() => import('../components/mail/MailAttachmentPreviewDialog'));


const SCOPE_OPTIONS = [
  { value: 'inbox', label: 'На согласование', mobileLabel: 'В работе' },
  { value: 'completed', label: 'Завершённые', mobileLabel: 'Готово' },
  { value: 'all', label: 'Все мои', mobileLabel: 'Все' },
];

const PROFILE_STATUS = {
  not_configured: { label: 'Не подключено', color: 'default' },
  configured: { label: 'Настроено', color: 'info' },
  valid: { label: 'Подключено', color: 'success' },
  invalid: { label: 'Неверные данные', color: 'error' },
  unavailable: { label: '1С недоступна', color: 'warning' },
};

const emptyCredentialDraft = { login: '', password: '' };

function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `docflow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function resolveDocflowError(error, fallback = 'Не удалось выполнить запрос к 1С.') {
  const detail = error?.response?.data?.detail;
  if (detail && typeof detail === 'object') {
    return {
      code: String(detail.code || ''),
      message: String(detail.message || fallback),
      correlationId: String(detail.correlation_id || error?.response?.headers?.['x-correlation-id'] || ''),
    };
  }
  if (typeof detail === 'string' && detail.trim()) {
    return {
      code: '',
      message: detail,
      correlationId: String(error?.response?.headers?.['x-correlation-id'] || ''),
    };
  }
  return {
    code: '',
    message: fallback,
    correlationId: String(error?.response?.headers?.['x-correlation-id'] || ''),
  };
}

function CredentialDialog({ open, profile, mobile, onClose, onSaved }) {
  const [draft, setDraft] = useState(emptyCredentialDraft);
  const [working, setWorking] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDraft({ login: String(profile?.login || ''), password: '' });
    setTestResult(null);
    setError(null);
  }, [open, profile?.login]);

  const payload = useMemo(() => ({
    login: draft.login.trim(),
    password: draft.password,
  }), [draft]);
  const canSubmit = Boolean(payload.login && payload.password && !working);

  const close = () => {
    setDraft(emptyCredentialDraft);
    setTestResult(null);
    setError(null);
    onClose();
  };

  const testConnection = async () => {
    if (!canSubmit) return;
    setWorking(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await docflowAPI.testCredentials(payload);
      setTestResult(result);
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось проверить учётную запись 1С.'));
    } finally {
      setWorking(false);
    }
  };

  const save = async () => {
    if (!canSubmit) return;
    setWorking(true);
    setError(null);
    try {
      const nextProfile = await docflowAPI.saveCredentials(payload);
      setDraft(emptyCredentialDraft);
      onSaved(nextProfile);
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось сохранить учётную запись 1С.'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onClose={working ? undefined : close} fullWidth maxWidth="sm" fullScreen={mobile}>
      <DialogTitle>Учётная запись 1С Документооборот</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            Данные проверяются в базе docflow и сохраняются только в зашифрованном виде. Пароль нельзя будет посмотреть после сохранения.
          </Alert>
          <TextField
            autoFocus
            label="Логин 1С"
            value={draft.login}
            onChange={(event) => setDraft((current) => ({ ...current, login: event.target.value }))}
            inputProps={{ maxLength: 128 }}
            autoComplete="username"
            disabled={working}
          />
          <TextField
            label="Пароль 1С"
            type="password"
            value={draft.password}
            onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
            inputProps={{ maxLength: 256 }}
            autoComplete="current-password"
            disabled={working}
          />
          {testResult?.connected ? (
            <Alert severity="success">Подключение к базе {testResult.configuration} выполнено.</Alert>
          ) : null}
          {error ? (
            <Alert severity="error">
              {error.message}
              {error.correlationId ? (
                <Typography display="block" variant="caption" sx={{ mt: 0.5 }}>
                  Код обращения: {error.correlationId}
                </Typography>
              ) : null}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', sm: 2.5 }, gap: { xs: 0.75, sm: 0 }, flexDirection: { xs: 'column-reverse', sm: 'row' }, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } }, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, minHeight: 44 } }}>
        <Button onClick={close} disabled={working}>Отмена</Button>
        <Button onClick={testConnection} disabled={!canSubmit}>Только проверить</Button>
        <Button variant="contained" onClick={save} disabled={!canSubmit}>
          {working ? <CircularProgress size={20} color="inherit" /> : 'Проверить и сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TaskActionDialog({ action, task, working, error, mobile, onClose, onConfirm }) {
  const [comment, setComment] = useState('');
  useEffect(() => {
    if (action) setComment('');
  }, [action]);
  const commentRequired = action?.comment_mode === 'required';
  const canConfirm = Boolean(action && !working && (!commentRequired || comment.trim()));
  return (
    <Dialog open={Boolean(action)} onClose={working ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={mobile}>
      <DialogTitle>{action?.label || 'Действие с заданием'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity={action?.code === 'reject' ? 'warning' : 'info'}>
            Задание будет изменено непосредственно в 1С. Автоматической отмены этого действия нет.
          </Alert>
          <Typography variant="body2" fontWeight={700}>{task?.title}</Typography>
          <TextField
            autoFocus={commentRequired}
            multiline
            minRows={3}
            label={commentRequired ? 'Комментарий или результат *' : 'Комментарий или результат'}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            inputProps={{ maxLength: 2000 }}
            disabled={working}
            helperText={commentRequired ? 'Без комментария действие выполнить нельзя.' : 'Необязательно для этого действия.'}
          />
          {error ? (
            <Alert severity="error">
              {error.message}
              {error.correlationId ? (
                <Typography variant="caption" display="block">Код обращения: {error.correlationId}</Typography>
              ) : null}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', sm: 2.5 } }}>
        <Button onClick={onClose} disabled={working}>Отмена</Button>
        <Button
          variant="contained"
          color={action?.tone || 'primary'}
          disabled={!canConfirm}
          onClick={() => onConfirm(comment.trim())}
        >
          {working ? <CircularProgress size={20} color="inherit" /> : action?.label}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function defaultAssignmentDueAt() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(12, 0, 0, 0);
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function AssignmentDialog({ open, mobile, capability, onClose, onCreated }) {
  const testOnly = capability?.test_only !== false;
  const requiredTitlePrefix = String(capability?.required_title_prefix || 'HUB-IT TEST').trim();
  const initialTitle = testOnly ? `${requiredTitlePrefix} · ` : '';
  const [draft, setDraft] = useState({
    document: null,
    assignee: null,
    controller: null,
    dueAt: defaultAssignmentDueAt(),
    importance: 'normal',
    title: initialTitle,
    description: '',
  });
  const [documentOptions, setDocumentOptions] = useState([]);
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [documentSearch, setDocumentSearch] = useState('');
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const [command, setCommand] = useState(null);
  const idempotencyKey = useRef('');

  const loadChoices = useCallback(async ({ documentQuery = '', assigneeQuery = '' } = {}) => {
    setLoadingChoices(true);
    setError(null);
    try {
      const [documents, assignees] = await Promise.all([
        docflowAPI.searchAssignmentDocuments({ q: documentQuery, limit: 20 }),
        docflowAPI.searchAssignmentAssignees({ q: assigneeQuery, limit: 20 }),
      ]);
      setDocumentOptions(Array.isArray(documents?.items) ? documents.items : []);
      setAssigneeOptions(Array.isArray(assignees?.items) ? assignees.items : []);
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось загрузить документы и исполнителей из 1С.'));
    } finally {
      setLoadingChoices(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    idempotencyKey.current = createIdempotencyKey();
    setDraft({
      document: null,
      assignee: null,
      controller: null,
      dueAt: defaultAssignmentDueAt(),
      importance: 'normal',
      title: initialTitle,
      description: '',
    });
    setDocumentSearch('');
    setAssigneeSearch('');
    setError(null);
    setCommand(null);
    void loadChoices();
  }, [initialTitle, loadChoices, open]);

  const canSubmit = Boolean(
    draft.document
    && draft.assignee
    && draft.dueAt
    && draft.title.trim().length > (testOnly ? requiredTitlePrefix.length : 0)
    && draft.description.trim()
    && !working
    && !command,
  );

  const submit = async () => {
    if (!canSubmit) return;
    setWorking(true);
    setError(null);
    try {
      const result = await docflowAPI.createAssignment({
        document_type: draft.document.document_type,
        document_ref: draft.document.ref,
        assignee_ref: draft.assignee.ref,
        controller_ref: draft.controller?.ref || null,
        due_at: draft.dueAt,
        importance: draft.importance,
        title: draft.title.trim(),
        description: draft.description.trim(),
      }, idempotencyKey.current);
      if (result?.status === 'applied' || result?.status === 'already_applied') {
        onCreated(result);
      } else {
        setCommand(result);
      }
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось создать поручение в 1С.'));
    } finally {
      setWorking(false);
    }
  };

  const checkCommand = async () => {
    if (!command?.command_id || working) return;
    setWorking(true);
    setError(null);
    try {
      const result = await docflowAPI.getAssignmentCommand(command.command_id);
      if (result?.status === 'applied' || result?.status === 'already_applied') {
        onCreated(result);
      } else {
        setCommand(result);
      }
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось проверить состояние поручения в 1С.'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onClose={working ? undefined : onClose} fullWidth maxWidth="md" fullScreen={mobile}>
      <DialogTitle>Создать поручение по документу 1С</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            {testOnly
              ? 'Пилот создаёт одно поручение одному исполнителю по уже существующему документу. После отправки действие нельзя повторять автоматически.'
              : 'Поручение будет создано непосредственно в 1С по существующему документу. После отправки действие нельзя повторять автоматически.'}
          </Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
            <Autocomplete
              fullWidth
              options={documentOptions}
              value={draft.document}
              onChange={(_, value) => setDraft((current) => ({ ...current, document: value }))}
              inputValue={documentSearch}
              onInputChange={(_, value) => setDocumentSearch(value)}
              getOptionLabel={(option) => `${option.title}${option.number ? ` · ${option.number}` : ''}`}
              isOptionEqualToValue={(option, value) => option.ref === value.ref}
              loading={loadingChoices}
              renderInput={(params) => <TextField {...params} label="Документ 1С" required />}
              renderOption={(props, option) => (
                <li {...props} key={`${option.document_type}-${option.ref}`}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>{option.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{option.document_type_label}{option.number ? ` · ${option.number}` : ''}</Typography>
                  </Box>
                </li>
              )}
            />
            <Button
              variant="outlined"
              onClick={() => void loadChoices({ documentQuery: documentSearch, assigneeQuery: assigneeSearch })}
              disabled={loadingChoices}
              sx={{ minHeight: 56, minWidth: { sm: 108 } }}
            >
              Найти
            </Button>
          </Stack>
          <Autocomplete
            options={assigneeOptions}
            value={draft.assignee}
            onChange={(_, value) => setDraft((current) => ({ ...current, assignee: value }))}
            inputValue={assigneeSearch}
            onInputChange={(_, value) => setAssigneeSearch(value)}
            getOptionLabel={(option) => option.name || ''}
            isOptionEqualToValue={(option, value) => option.ref === value.ref}
            loading={loadingChoices}
            renderInput={(params) => <TextField {...params} label="Исполнитель" required />}
            renderOption={(props, option) => (
              <li {...props} key={option.ref}>
                <Box>
                  <Typography variant="body2" fontWeight={700}>{option.name}</Typography>
                  {option.department ? <Typography variant="caption" color="text.secondary">{option.department}</Typography> : null}
                </Box>
              </li>
            )}
          />
          <Autocomplete
            options={assigneeOptions}
            value={draft.controller}
            onChange={(_, value) => setDraft((current) => ({ ...current, controller: value }))}
            getOptionLabel={(option) => option.name || ''}
            isOptionEqualToValue={(option, value) => option.ref === value.ref}
            renderInput={(params) => <TextField {...params} label="Контролёр (необязательно)" />}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              type="datetime-local"
              label="Срок исполнения"
              value={draft.dueAt}
              onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
              InputLabelProps={{ shrink: true }}
              required
            />
            <TextField
              fullWidth
              select
              label="Важность"
              value={draft.importance}
              onChange={(event) => setDraft((current) => ({ ...current, importance: event.target.value }))}
            >
              <MenuItem value="normal">Обычная</MenuItem>
              <MenuItem value="high">Высокая</MenuItem>
            </TextField>
          </Stack>
          <TextField
            label="Название поручения"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            inputProps={{ maxLength: 200 }}
            helperText={testOnly ? `Название должно начинаться с ${requiredTitlePrefix}.` : 'Укажите понятное название поручения для исполнителя.'}
            required
          />
          <TextField
            multiline
            minRows={4}
            label="Описание поручения"
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            inputProps={{ maxLength: 2000 }}
            required
          />
          {command ? (
            <Alert
              severity="warning"
              action={<Button color="inherit" onClick={() => void checkCommand()} disabled={working}>Проверить</Button>}
            >
              Проверяем состояние поручения. Повторное создание отключено.
              {command.correlation_id ? <Typography variant="caption" display="block">Код обращения: {command.correlation_id}</Typography> : null}
            </Alert>
          ) : null}
          {error ? (
            <Alert severity="error">
              {error.message}
              {error.correlationId ? <Typography variant="caption" display="block">Код обращения: {error.correlationId}</Typography> : null}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', sm: 2.5 }, gap: 1 }}>
        <Button onClick={onClose} disabled={working}>Закрыть</Button>
        {!command ? (
          <Button variant="contained" onClick={() => void submit()} disabled={!canSubmit}>
            {working ? <CircularProgress size={20} color="inherit" /> : 'Создать в 1С'}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

export default function Docflow() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [assignmentCapability, setAssignmentCapability] = useState(null);
  const [assignmentNotice, setAssignmentNotice] = useState(null);
  const [scope, setScope] = useState('inbox');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [taskDetailError, setTaskDetailError] = useState(null);
  const [fileActionError, setFileActionError] = useState(null);
  const [taskAction, setTaskAction] = useState(null);
  const [taskActionWorking, setTaskActionWorking] = useState(false);
  const [taskActionError, setTaskActionError] = useState(null);
  const [taskActionNotice, setTaskActionNotice] = useState(null);
  const [commandState, setCommandState] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(createEmptyAttachmentPreview);
  const [credentialsRevision, setCredentialsRevision] = useState(0);
  const requestSequence = useRef(0);
  const loadedRequestKey = useRef('');
  const inFlightRequest = useRef(null);
  const selectedTaskRef = useRef('');
  const detailCache = useRef(new Map());
  const detailInFlight = useRef(new Map());
  const previewSequence = useRef(0);
  const previewObjectUrl = useRef('');

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      setProfile(await docflowAPI.getProfile());
    } catch (error) {
      setProfileError(resolveDocflowError(error, 'Не удалось загрузить состояние подключения 1С.'));
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadTasks = useCallback(() => {
    if (!profile?.configured) {
      setTasks([]);
      setTasksError(null);
      return Promise.resolve();
    }
    const requestKey = `${credentialsRevision}|${scope}|${search}`;
    if (inFlightRequest.current?.key === requestKey) {
      return inFlightRequest.current.promise;
    }
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const sameParameters = loadedRequestKey.current === requestKey;
    if (!sameParameters) {
      setTasks([]);
      setTruncated(false);
      setSelectedTask(null);
      selectedTaskRef.current = '';
      setTaskDetailLoading(false);
      setTaskDetailError(null);
      setFileActionError(null);
    }
    setTasksLoading(true);
    setTasksError(null);

    let promise;
    promise = (async () => {
      try {
        const result = await docflowAPI.listTasks({ scope, q: search, limit: 50 });
        if (requestSequence.current !== requestId) return;
        loadedRequestKey.current = requestKey;
        setTasks(Array.isArray(result?.items) ? result.items : []);
        setTruncated(Boolean(result?.truncated));
        setLastUpdatedAt(String(result?.as_of || ''));
      } catch (error) {
        if (requestSequence.current !== requestId) return;
        if (!sameParameters) setTasks([]);
        setTasksError(resolveDocflowError(error, 'Не удалось загрузить задания из 1С.'));
      } finally {
        if (inFlightRequest.current?.promise === promise) inFlightRequest.current = null;
        if (requestSequence.current === requestId) setTasksLoading(false);
      }
    })();
    inFlightRequest.current = { key: requestKey, promise };
    return promise;
  }, [credentialsRevision, profile?.configured, scope, search]);

  const loadTaskDetail = useCallback((task, { force = false } = {}) => {
    const taskRef = String(task?.ref || '').trim();
    if (!taskRef) return Promise.resolve(null);
    if (force) detailCache.current.delete(taskRef);
    const cached = detailCache.current.get(taskRef);
    if (cached) {
      if (selectedTaskRef.current === taskRef) {
        setSelectedTask(cached);
        setTaskDetailLoading(false);
        setTaskDetailError(null);
      }
      return Promise.resolve(cached);
    }
    const existing = detailInFlight.current.get(taskRef);
    if (existing) return existing;
    if (selectedTaskRef.current === taskRef) {
      setTaskDetailLoading(true);
      setTaskDetailError(null);
    }
    let promise;
    promise = (async () => {
      try {
        const detail = await docflowAPI.getTask(taskRef);
        detailCache.current.set(taskRef, detail);
        if (selectedTaskRef.current === taskRef) {
          setSelectedTask(detail);
          setTaskDetailError(null);
        }
        return detail;
      } catch (error) {
        if (selectedTaskRef.current === taskRef) {
          setTaskDetailError(resolveDocflowError(error, 'Не удалось загрузить подробную карточку задания.'));
        }
        return null;
      } finally {
        if (detailInFlight.current.get(taskRef) === promise) detailInFlight.current.delete(taskRef);
        if (selectedTaskRef.current === taskRef) setTaskDetailLoading(false);
      }
    })();
    detailInFlight.current.set(taskRef, promise);
    return promise;
  }, []);

  const openTask = useCallback((task) => {
    const taskRef = String(task?.ref || '').trim();
    if (!taskRef) return;
    selectedTaskRef.current = taskRef;
    setFileActionError(null);
    setTaskDetailError(null);
    setSelectedTask(detailCache.current.get(taskRef) || task);
    void loadTaskDetail(task);
  }, [loadTaskDetail]);

  const closeTask = useCallback(() => {
    selectedTaskRef.current = '';
    setSelectedTask(null);
    setTaskDetailLoading(false);
    setTaskDetailError(null);
    setFileActionError(null);
    setTaskAction(null);
    setTaskActionError(null);
    setTaskActionNotice(null);
    setCommandState(null);
  }, []);

  const applySelectedTaskAction = useCallback(async (comment) => {
    const taskRef = String(selectedTask?.ref || '').trim();
    const stateToken = String(selectedTask?.state_token || '').trim();
    if (!taskRef || !stateToken || !taskAction) return;
    setTaskActionWorking(true);
    setTaskActionError(null);
    setTaskActionNotice(null);
    try {
      const result = await docflowAPI.applyTaskAction(
        taskRef,
        { action: taskAction.code, comment, state_token: stateToken },
        taskAction.idempotencyKey,
      );
      if (result?.status === 'applied' || result?.status === 'already_applied') {
        const nextTask = result.task || await docflowAPI.getTask(taskRef);
        detailCache.current.set(taskRef, nextTask);
        if (selectedTaskRef.current === taskRef) setSelectedTask(nextTask);
        setTaskAction(null);
        setCommandState(null);
        setTaskActionNotice({ severity: 'success', message: '1С подтвердила выполнение задания.' });
        await loadTasks();
      } else {
        setTaskAction(null);
        setCommandState(result);
      }
    } catch (error) {
      setTaskActionError(resolveDocflowError(error, 'Не удалось выполнить действие в 1С.'));
    } finally {
      setTaskActionWorking(false);
    }
  }, [loadTasks, selectedTask, taskAction]);

  const checkTaskCommand = useCallback(async () => {
    const commandId = String(commandState?.command_id || '').trim();
    if (!commandId || taskActionWorking) return;
    setTaskActionWorking(true);
    setTaskActionNotice(null);
    try {
      const result = await docflowAPI.getCommand(commandId);
      setCommandState(result);
      if (result?.status === 'applied' || result?.status === 'already_applied') {
        const nextTask = result.task;
        if (nextTask?.ref) {
          detailCache.current.set(nextTask.ref, nextTask);
          if (selectedTaskRef.current === nextTask.ref) setSelectedTask(nextTask);
        }
        setCommandState(null);
        setTaskActionNotice({ severity: 'success', message: '1С подтвердила выполнение задания.' });
        await loadTasks();
      }
    } catch (error) {
      const resolved = resolveDocflowError(error, 'Не удалось проверить состояние команды в 1С.');
      setTaskActionNotice({ severity: 'error', message: resolved.message });
    } finally {
      setTaskActionWorking(false);
    }
  }, [commandState, loadTasks, taskActionWorking]);

  const revokePreviewObjectUrl = useCallback(() => {
    if (previewObjectUrl.current && typeof window.URL?.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(previewObjectUrl.current);
    }
    previewObjectUrl.current = '';
  }, []);

  const closeAttachmentPreview = useCallback(() => {
    previewSequence.current += 1;
    revokePreviewObjectUrl();
    setAttachmentPreview(createEmptyAttachmentPreview());
  }, [revokePreviewObjectUrl]);

  const openAttachmentPreview = useCallback(async (task, file) => {
    const taskRef = String(task?.ref || '').trim();
    const fileRef = String(file?.ref || '').trim();
    if (!taskRef || !fileRef) return;
    const sequence = previewSequence.current + 1;
    previewSequence.current = sequence;
    revokePreviewObjectUrl();
    setFileActionError(null);
    setAttachmentPreview({
      ...createEmptyAttachmentPreview(),
      open: true,
      loading: true,
      filename: file?.name || 'Файл 1С',
      contentType: file?.content_type || 'application/octet-stream',
      downloadContext: { task, file },
    });
    try {
      const filename = String(file?.name || 'document.bin');
      const contentType = String(file?.content_type || 'application/octet-stream');
      const officeSourceKind = getOfficeAttachmentSourceKind({ filename, contentType });
      let nextPreview;
      if (officeSourceKind) {
        const response = await docflowAPI.downloadFilePreviewPdf(taskRef, fileRef);
        const { blob, filename: pdfFilename } = buildAttachmentBlobPayload({
          response,
          attachment: {
            name: `${filename.replace(/\.[^.]+$/, '') || 'preview'}.pdf`,
            content_type: 'application/pdf',
          },
        });
        const objectUrl = typeof window.URL?.createObjectURL === 'function'
          ? window.URL.createObjectURL(blob)
          : '';
        if (previewSequence.current !== sequence) {
          if (objectUrl) window.URL.revokeObjectURL(objectUrl);
          return;
        }
        previewObjectUrl.current = objectUrl;
        nextPreview = {
          ...createEmptyAttachmentPreview(),
          open: true,
          filename,
          contentType,
          kind: 'office_pdf',
          previewKind: 'office_pdf',
          sourceKind: String(response?.headers?.['x-docflow-preview-source-kind'] || officeSourceKind),
          objectUrl,
          previewBlob: blob,
          pdfFilename,
          pageCount: Number(response?.headers?.['x-docflow-preview-page-count'] || 0),
          downloadContext: { task, file },
        };
      } else {
        const response = await docflowAPI.downloadFile(taskRef, fileRef, { disposition: 'inline' });
        nextPreview = await buildAttachmentPreviewState({
          response,
          attachment: { name: filename, content_type: contentType, size: file?.size || 0 },
          createObjectUrl: (blob) => {
            const objectUrl = typeof window.URL?.createObjectURL === 'function'
              ? window.URL.createObjectURL(blob)
              : '';
            previewObjectUrl.current = objectUrl;
            return objectUrl;
          },
        });
        nextPreview.downloadContext = { task, file };
      }
      if (previewSequence.current === sequence) {
        setAttachmentPreview(nextPreview);
      } else if (nextPreview?.objectUrl && typeof window.URL?.revokeObjectURL === 'function') {
        window.URL.revokeObjectURL(nextPreview.objectUrl);
      }
    } catch (error) {
      if (previewSequence.current !== sequence) return;
      const resolved = resolveDocflowError(error, 'Не удалось открыть предпросмотр файла из 1С.');
      setAttachmentPreview((current) => ({ ...current, loading: false, error: resolved.message }));
    }
  }, [revokePreviewObjectUrl]);

  const downloadTaskFile = useCallback(async (task, file, existingBlob = null) => {
    const taskRef = String(task?.ref || '').trim();
    const fileRef = String(file?.ref || '').trim();
    if (!taskRef || !fileRef) return;
    setFileActionError(null);
    try {
      if (existingBlob instanceof Blob) {
        downloadBlobFile(existingBlob, file?.name || 'document.bin', { preferOpenFallback: true });
        return;
      }
      const response = await docflowAPI.downloadFile(taskRef, fileRef, { disposition: 'attachment' });
      const { blob, filename } = buildAttachmentBlobPayload({
        response,
        attachment: { name: file?.name || 'document.bin', content_type: file?.content_type },
      });
      downloadBlobFile(blob, filename, { preferOpenFallback: true });
    } catch (error) {
      setFileActionError(resolveDocflowError(error, 'Не удалось скачать файл из 1С.'));
    }
  }, []);

  useEffect(() => () => revokePreviewObjectUrl(), [revokePreviewObjectUrl]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!profileLoading) void loadTasks();
  }, [loadTasks, profileLoading]);

  useEffect(() => {
    let active = true;
    if (!profile?.configured) {
      setAssignmentCapability(null);
      return () => { active = false; };
    }
    docflowAPI.getAssignmentCapability()
      .then((result) => {
        if (active) setAssignmentCapability(result);
      })
      .catch((error) => {
        if (!active) return;
        if (error?.response?.status === 403) {
          setAssignmentCapability(null);
          return;
        }
        setAssignmentCapability({ enabled: false, reason: 'Не удалось проверить доступ к созданию поручений.' });
      });
    return () => { active = false; };
  }, [profile?.configured]);

  const applySearch = (event) => {
    event?.preventDefault?.();
    setSearch(searchDraft.trim());
  };

  const removeCredentials = async () => {
    if (!window.confirm('Удалить сохранённые данные подключения к 1С?')) return;
    try {
      await docflowAPI.deleteCredentials();
      setTasks([]);
      closeTask();
      closeAttachmentPreview();
      detailCache.current.clear();
      detailInFlight.current.clear();
      loadedRequestKey.current = '';
      setProfile({ configured: false, login: null, status: 'not_configured' });
    } catch (error) {
      setProfileError(resolveDocflowError(error, 'Не удалось удалить данные подключения 1С.'));
    }
  };

  const profileStatus = PROFILE_STATUS[profile?.status] || PROFILE_STATUS.configured;

  return (
    <MainLayout>
      <PageShell sx={{ pb: isMobile ? 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 12px)' : 2 }}>
        {isMobile ? <MobileShellPageHeader title="1С · Документооборот" sx={{ mb: 1 }} /> : null}
        <Stack spacing={{ xs: 1.25, sm: 2.25 }}>
          <Stack
            direction={{ sm: 'row' }}
            spacing={1.5}
            justifyContent="space-between"
            alignItems="center"
            sx={{ display: { xs: 'none', sm: 'flex' } }}
          >
            <Box>
              <Typography variant="h5" fontWeight={800}>Документооборот</Typography>
              <Typography variant="body2" color="text.secondary">
                Ваши персональные задания и согласования из 1С. Права на документы определяет 1С.
              </Typography>
            </Box>
          </Stack>

          <Paper
            variant="outlined"
            sx={{
              p: { xs: 1.5, sm: 2 },
              borderRadius: { xs: 3.5, sm: 3 },
              background: (themeValue) => themeValue.palette.mode === 'dark'
                ? 'linear-gradient(145deg, rgba(25,118,210,.18), rgba(25,118,210,.03))'
                : 'linear-gradient(145deg, rgba(25,118,210,.10), rgba(255,255,255,.72))',
            }}
          >
            <Stack direction="row" spacing={1.25} alignItems="flex-start">
              <Box sx={{ width: 42, height: 42, borderRadius: 2.5, bgcolor: profile?.configured ? 'primary.main' : 'action.disabledBackground', color: profile?.configured ? 'primary.contrastText' : 'text.disabled', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <AssignmentTurnedInOutlinedIcon />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                  <Typography fontWeight={800}>Мои задания 1С</Typography>
                  {!profileLoading ? <Chip size="small" color={profileStatus.color} label={profileStatus.label} /> : <Skeleton width={92} height={26} />}
                </Stack>
                {profileLoading ? <Skeleton width="72%" /> : (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, overflowWrap: 'anywhere' }}>
                    {profile?.configured ? `Подключено как ${profile.login || 'пользователь 1С'}` : 'Подключите личную учётную запись, чтобы начать работу.'}
                  </Typography>
                )}
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
              <Button
                startIcon={<KeyOutlinedIcon />}
                variant={profile?.configured ? 'outlined' : 'contained'}
                onClick={() => setDialogOpen(true)}
                disabled={profileLoading}
                sx={{ flex: { xs: 1, sm: '0 0 auto' }, minHeight: 42 }}
              >
                {profile?.configured ? 'Настроить' : 'Подключить 1С'}
              </Button>
              {assignmentCapability ? (
                <Tooltip title={assignmentCapability.enabled ? 'Создать поручение по существующему документу 1С' : assignmentCapability.reason || ''}>
                  <span>
                    <Button
                      startIcon={<AddTaskOutlinedIcon />}
                      variant="outlined"
                      onClick={() => setAssignmentDialogOpen(true)}
                      disabled={!assignmentCapability.enabled}
                      sx={{ minHeight: 42 }}
                    >
                      Создать поручение
                    </Button>
                  </span>
                </Tooltip>
              ) : null}
              <Tooltip title="Обновить задания">
                <span>
                  <IconButton
                    onClick={() => void loadTasks()}
                    disabled={!profile?.configured || tasksLoading}
                    aria-label="Обновить задания"
                    sx={{ width: 42, height: 42, border: 1, borderColor: 'divider' }}
                  >
                    <RefreshOutlinedIcon />
                  </IconButton>
                </span>
              </Tooltip>
              {profile?.configured ? (
                <Button color="error" size="small" startIcon={isMobile ? undefined : <DeleteOutlineOutlinedIcon />} onClick={removeCredentials} sx={{ minHeight: 42 }}>
                  Отключить
                </Button>
              ) : null}
            </Stack>
          </Paper>

          {profileError ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void loadProfile()}>Повторить</Button>}>
              {profileError.message}
            </Alert>
          ) : null}

          {assignmentNotice ? (
            <Alert severity={assignmentNotice.severity || 'success'} onClose={() => setAssignmentNotice(null)}>
              {assignmentNotice.message}
            </Alert>
          ) : null}

          {!profileLoading && !profileError && !profile?.configured ? (
            <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => setDialogOpen(true)}>Подключить</Button>}>
              Введите личные данные 1С, чтобы увидеть только назначенные вам задания.
            </Alert>
          ) : null}

          {!profileLoading && profile?.configured ? (
            <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', minWidth: 0 }}>
              <Stack spacing={1.5} sx={{ p: { xs: 1.5, sm: 2 } }}>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={scope}
                  onChange={(_, value) => value && setScope(value)}
                  disabled={tasksLoading}
                  aria-label="Состав заданий"
                  fullWidth={isMobile}
                  sx={{
                    alignSelf: { xs: 'stretch', sm: 'flex-start' },
                    maxWidth: '100%',
                    '& .MuiToggleButton-root': {
                      minHeight: 42,
                      px: { xs: 1, sm: 1.5 },
                      whiteSpace: 'nowrap',
                      fontSize: { xs: '0.75rem', sm: '0.8125rem' },
                    },
                  }}
                >
                  {SCOPE_OPTIONS.map((option) => (
                    <ToggleButton key={option.value} value={option.value}>
                      {isMobile ? option.mobileLabel : option.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Box component="form" onSubmit={applySearch} sx={{ display: 'flex', gap: 1, minWidth: 0 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Поиск по моим заданиям"
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    inputProps={{ maxLength: 200 }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment>
                      ),
                    }}
                  />
                  <Button type="submit" variant="contained" disabled={tasksLoading} aria-label="Найти" sx={{ minWidth: { xs: 46, sm: 88 }, minHeight: 42, px: { xs: 1.25, sm: 2 } }}>
                    <SearchOutlinedIcon sx={{ display: { xs: 'block', sm: 'none' } }} />
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Найти</Box>
                  </Button>
                </Box>
              </Stack>
              <Divider />

              {tasks.length > 0 ? (
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: { xs: 1.5, sm: 2.5 }, py: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Найдено: {tasks.length}
                  </Typography>
                  {lastUpdatedAt ? <Typography variant="caption" color="text.secondary">Данные из 1С</Typography> : null}
                </Stack>
              ) : null}
              {tasksLoading && tasks.length > 0 ? <LinearProgress aria-label="Обновляем задания" /> : null}

              {tasksError ? (
                <Alert
                  severity={tasksError.code === 'DOCFLOW_MAPPING_REQUIRED' ? 'warning' : 'error'}
                  action={<Button color="inherit" size="small" onClick={() => void loadTasks()}>Повторить</Button>}
                  sx={{ m: 2 }}
                >
                  {tasksError.message}
                  {tasksError.correlationId ? (
                    <Typography display="block" variant="caption" sx={{ mt: 0.5 }}>
                      Код обращения: {tasksError.correlationId}
                    </Typography>
                  ) : null}
                </Alert>
              ) : null}

              {tasksLoading && tasks.length === 0 ? (
                <Stack data-testid="docflow-task-skeleton" spacing={1.25} sx={{ p: { xs: 1.5, sm: 2.5 } }}>
                  <Typography variant="body2" color="text.secondary">Первое подключение к 1С может занять до минуты…</Typography>
                  {[0, 1, 2].map((item) => (
                    <Paper key={item} variant="outlined" sx={{ p: 1.5, borderRadius: 2.5 }}>
                      <Skeleton width={`${82 - item * 9}%`} height={24} />
                      <Skeleton width="44%" />
                      <Skeleton width="66%" />
                    </Paper>
                  ))}
                </Stack>
              ) : null}

              {!tasksLoading && !tasksError && tasks.length === 0 ? (
                <Stack alignItems="center" spacing={1} sx={{ px: 2, py: 7, textAlign: 'center' }}>
                  <AssignmentTurnedInOutlinedIcon color="disabled" sx={{ fontSize: 42 }} />
                  <Typography fontWeight={700}>Заданий нет</Typography>
                  <Typography variant="body2" color="text.secondary">
                    1С не вернула заданий для выбранного режима и поиска.
                  </Typography>
                </Stack>
              ) : null}

              {tasks.length > 0 ? (
                <>
                  <List disablePadding>
                    {tasks.map((task) => <DocflowTaskCard key={task.ref} task={task} onOpen={openTask} />)}
                  </List>
                  {truncated ? (
                    <Alert severity="info" sx={{ m: 2 }}>Показаны первые 50 заданий. Уточните поиск.</Alert>
                  ) : null}
                </>
              ) : null}
            </Paper>
          ) : null}

          <Alert severity="info" variant="outlined">
            Действия появляются в карточке только для проверенного типа процесса и пилотного тестового задания. Если кнопок нет, задание доступно только для чтения.
          </Alert>
        </Stack>
      </PageShell>

      <CredentialDialog
        open={dialogOpen}
        profile={profile}
        mobile={isMobile}
        onClose={() => setDialogOpen(false)}
        onSaved={(nextProfile) => {
          setProfile(nextProfile);
          detailCache.current.clear();
          detailInFlight.current.clear();
          setCredentialsRevision((value) => value + 1);
          setDialogOpen(false);
        }}
      />
      <AssignmentDialog
        open={assignmentDialogOpen}
        mobile={isMobile}
        capability={assignmentCapability}
        onClose={() => setAssignmentDialogOpen(false)}
        onCreated={(result) => {
          setAssignmentDialogOpen(false);
          const processRef = String(result?.assignment?.process_ref || '').trim();
          setAssignmentNotice({
            severity: 'success',
            message: processRef
              ? `1С подтвердила создание поручения. Процесс: ${processRef}`
              : '1С подтвердила создание поручения.',
          });
        }}
      />
      <DocflowTaskDetails
        task={selectedTask}
        mobile={isMobile}
        loading={taskDetailLoading}
        error={taskDetailError}
        fileError={fileActionError}
        actionNotice={taskActionNotice}
        actionWorking={taskActionWorking}
        commandState={commandState}
        onRetry={() => void loadTaskDetail(selectedTask, { force: true })}
        onRefresh={() => void loadTaskDetail(selectedTask, { force: true })}
        onPreviewFile={(task, file) => void openAttachmentPreview(task, file)}
        onDownloadFile={(task, file) => void downloadTaskFile(task, file)}
        onAction={(action) => {
          setTaskActionError(null);
          setTaskAction({ ...action, idempotencyKey: createIdempotencyKey() });
        }}
        onCheckCommand={() => void checkTaskCommand()}
        onClose={closeTask}
      />
      <TaskActionDialog
        action={taskAction}
        task={selectedTask}
        working={taskActionWorking}
        error={taskActionError}
        mobile={isMobile}
        onClose={() => {
          setTaskAction(null);
          setTaskActionError(null);
        }}
        onConfirm={(comment) => void applySelectedTaskAction(comment)}
      />
      <Suspense fallback={null}>
        <MailAttachmentPreviewDialog
          attachmentPreview={attachmentPreview}
          onClose={closeAttachmentPreview}
          onDownload={() => {
            const context = attachmentPreview.downloadContext;
            if (!context) return;
            void downloadTaskFile(context.task, context.file, attachmentPreview.blob);
          }}
          onDownloadPreviewPdf={() => {
            if (!attachmentPreview.previewBlob) return;
            downloadBlobFile(
              attachmentPreview.previewBlob,
              attachmentPreview.pdfFilename || 'preview.pdf',
              { preferOpenFallback: true },
            );
          }}
          formatFileSize={formatDocflowFileSize}
          maxPreviewFileBytes={MAX_PREVIEW_FILE_BYTES}
        />
      </Suspense>
    </MainLayout>
  );
}
