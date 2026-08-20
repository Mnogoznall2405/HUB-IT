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
  ListItemIcon,
  ListItemText,
  Menu,
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
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import MainLayout from '../components/layout/MainLayout';
import MobileShellPageHeader from '../components/layout/MobileShellPageHeader';
import PageShell from '../components/layout/PageShell';
import { useAuth } from '../contexts/AuthContext';
import { docflowAPI } from '../api/docflow';
import { hideScrollbarSx } from '../lib/hideScrollbarSx';
import { waitForAttachmentPreview } from '../components/documentPreview/asyncAttachmentPreview';
import {
  buildAttachmentBlobPayload,
  buildAttachmentPreviewState,
  createEmptyAttachmentPreview,
  downloadBlobFile,
  getOfficeAttachmentSourceKind,
  MAX_PREVIEW_FILE_BYTES,
} from '../components/mail/mailMessageFileActions';
import {
  DocflowTaskDetails,
  DocflowTaskList,
  formatDocflowDate,
  formatDocflowFileSize,
} from './docflow/DocflowTaskSurface';
import {
  clearAllDocflowTasksCache,
  clearDocflowTasksCacheByLogin,
  isDocflowTasksCacheFresh,
  isHeavyDocflowTasksScope,
  patchDocflowTasksCacheAfterCompletion,
  readDocflowTasksCache,
  writeDocflowTasksCache,
} from './docflow/docflowTasksCache';


const MailAttachmentPreviewDialog = lazy(() => import('../components/mail/MailAttachmentPreviewDialog'));

const rememberDetail = (cache, key, value) => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > 24) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
};


const SCOPE_OPTIONS = [
  { value: 'inbox', label: 'Согласование' },
  { value: 'completed', label: 'Завершённые' },
  { value: 'all', label: 'Все' },
];

function filterDocflowTasks(tasks, query) {
  const tokens = String(query || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return Array.isArray(tasks) ? tasks : [];
  return (Array.isArray(tasks) ? tasks : []).filter((task) => {
    const haystack = [task?.title, task?.number, task?.author, task?.subject, task?.description]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ru-RU');
    return tokens.every((token) => haystack.includes(token));
  });
}

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

function buildCompletedTaskSnapshot(baseTask, taskRef) {
  return {
    ...(baseTask || {}),
    ref: String(baseTask?.ref || taskRef || '').trim(),
    completed: true,
    available_actions: [],
    state_token: null,
  };
}

function keepCompletedIfStale(refreshed, fallback) {
  if (refreshed?.completed) return refreshed;
  return buildCompletedTaskSnapshot({ ...(refreshed || {}), ...(fallback || {}) }, fallback?.ref || refreshed?.ref);
}

function updateTaskListAfterCompletion(items, completedTask, scope) {
  const list = Array.isArray(items) ? items : [];
  const completedRef = String(completedTask?.ref || '').trim().toLowerCase();
  if (!completedRef) return list;
  const withoutCompleted = list.filter(
    (item) => String(item?.ref || '').trim().toLowerCase() !== completedRef,
  );
  if (scope === 'inbox') return withoutCompleted;
  if (scope === 'completed') return [completedTask, ...withoutCompleted];
  return list.map((item) => (
    String(item?.ref || '').trim().toLowerCase() === completedRef ? completedTask : item
  ));
}

export function resolveDocflowError(error, fallback = 'Не удалось выполнить запрос к 1С.') {
  const status = Number(error?.response?.status || 0);
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
  if (status === 503 || status === 504) {
    return {
      code: 'docflow_timeout',
      // Keep caller fallback: same 503 is used for search, files, and actions.
      message: String(fallback || '1С не успела ответить. Повторите попытку позже.'),
      correlationId: String(error?.response?.headers?.['x-correlation-id'] || ''),
    };
  }
  return {
    code: '',
    message: fallback,
    correlationId: String(error?.response?.headers?.['x-correlation-id'] || ''),
  };
}

const ASSIGNMENT_DOC_SEARCH_MIN = 3;

function buildDocflowLoginFromFullName(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  const surname = parts[0];
  const initials = parts
    .slice(1, 3)
    .map((part) => String(part[0] || '').toLocaleUpperCase('ru-RU'))
    .join('');
  return `${surname}${initials}`;
}

export function resolveCredentialLogin(profile, user) {
  const savedLogin = String(profile?.login || '').trim();
  if (savedLogin) return savedLogin;
  const fromFullName = buildDocflowLoginFromFullName(user?.full_name);
  if (fromFullName) return fromFullName;
  return String(user?.username || '').trim();
}

const credentialFieldSx = {
  '& .MuiInputBase-input': { fontSize: { xs: 16, sm: 'inherit' } },
  '& .MuiInputBase-input:-webkit-autofill': {
    WebkitBoxShadow: (theme) => `0 0 0 100px ${theme.palette.background.paper} inset`,
    WebkitTextFillColor: (theme) => theme.palette.text.primary,
    caretColor: (theme) => theme.palette.text.primary,
    borderRadius: 'inherit',
    transition: 'background-color 99999s ease-out 0s',
  },
  '& .MuiInputBase-input:-webkit-autofill:hover, & .MuiInputBase-input:-webkit-autofill:focus, & .MuiInputBase-input:-webkit-autofill:active': {
    WebkitBoxShadow: (theme) => `0 0 0 100px ${theme.palette.background.paper} inset`,
    WebkitTextFillColor: (theme) => theme.palette.text.primary,
  },
};

function CredentialDialog({ open, profile, mobile, onClose, onSaved }) {
  const { user } = useAuth();
  const loginInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const [draft, setDraft] = useState(emptyCredentialDraft);
  const [workingAction, setWorkingAction] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const working = Boolean(workingAction);

  useEffect(() => {
    if (!open) return;
    setDraft({ login: resolveCredentialLogin(profile, user), password: '' });
    setTestResult(null);
    setError(null);
    setAttempted(false);
    setShowPassword(false);
  }, [open, profile?.login, user?.username]);

  const payload = useMemo(() => ({
    login: draft.login.trim(),
    password: draft.password,
  }), [draft]);
  const loginMissing = attempted && !payload.login;
  const passwordMissing = attempted && !payload.password;

  const readLiveCredentials = () => ({
    login: String(loginInputRef.current?.value ?? draft.login).trim(),
    password: String(passwordInputRef.current?.value ?? draft.password),
  });

  const validate = () => {
    const live = readLiveCredentials();
    setDraft((current) => ({
      ...current,
      login: live.login,
      password: live.password,
    }));
    setAttempted(true);
    if (!live.login) {
      loginInputRef.current?.focus();
      return false;
    }
    if (!live.password) {
      passwordInputRef.current?.focus();
      return false;
    }
    return true;
  };

  const close = () => {
    setDraft(emptyCredentialDraft);
    setTestResult(null);
    setError(null);
    setAttempted(false);
    setShowPassword(false);
    onClose();
  };

  const testConnection = async () => {
    if (!validate() || working) return;
    const live = readLiveCredentials();
    setWorkingAction('test');
    setError(null);
    setTestResult(null);
    try {
      const result = await docflowAPI.testCredentials(live);
      setTestResult(result);
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось проверить учётную запись 1С.'));
    } finally {
      setWorkingAction('');
    }
  };

  const save = async () => {
    if (!validate() || working) return;
    const live = readLiveCredentials();
    setWorkingAction('save');
    setError(null);
    try {
      const nextProfile = await docflowAPI.saveCredentials(live);
      setDraft(emptyCredentialDraft);
      onSaved(nextProfile);
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось сохранить учётную запись 1С.'));
    } finally {
      setWorkingAction('');
    }
  };

  const updateDraft = (field) => (event) => {
    setDraft((current) => ({ ...current, [field]: event.target.value }));
    setTestResult(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onClose={working ? undefined : close}
      fullWidth
      maxWidth="sm"
      fullScreen={mobile}
      PaperProps={{ sx: { borderRadius: mobile ? 0 : 3, overscrollBehavior: 'contain' } }}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(event) => { event.preventDefault(); void save(); }}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: mobile ? '100dvh' : 0 }}
      >
        <DialogTitle
          component="div"
          sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 28px)', sm: 3 }, pb: 1 }}
        >
          <Stack spacing={1.25} alignItems={mobile ? 'center' : 'flex-start'} textAlign={mobile ? 'center' : 'start'}>
            <Box
              sx={{
                width: 52,
                height: 52,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 3,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                boxShadow: (themeValue) => `0 10px 28px ${themeValue.palette.primary.main}33`,
              }}
            >
              <LockOutlinedIcon />
            </Box>
            <Typography component="h2" variant="h6" fontWeight={800} sx={{ textWrap: 'balance' }}>
              Подключение к 1С
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent
          sx={{
            px: { xs: 2, sm: 3 },
            pt: '20px !important',
            pb: 1.5,
            flex: 1,
            overflow: 'visible',
          }}
        >
          <Stack spacing={2.5} sx={{ width: '100%', maxWidth: 480, mx: 'auto' }}>
            <TextField
              inputRef={loginInputRef}
              required
              fullWidth
              name="docflow-1c-login"
              label="Логин 1С"
              value={draft.login}
              onChange={updateDraft('login')}
              inputProps={{ maxLength: 128, spellCheck: false, autoComplete: 'off' }}
              autoComplete="off"
              disabled={working}
              error={loginMissing}
              helperText={loginMissing ? 'Введите логин от 1С.' : undefined}
              InputLabelProps={{ shrink: true }}
              sx={credentialFieldSx}
            />
            <TextField
              autoFocus={!mobile}
              required
              fullWidth
              inputRef={passwordInputRef}
              name="docflow-1c-password"
              label="Пароль 1С"
              type={showPassword ? 'text' : 'password'}
              value={draft.password}
              onChange={updateDraft('password')}
              inputProps={{ maxLength: 256, autoComplete: 'new-password' }}
              autoComplete="new-password"
              disabled={working}
              error={passwordMissing}
              helperText={passwordMissing ? 'Введите пароль от 1С.' : undefined}
              InputLabelProps={{ shrink: true }}
              sx={credentialFieldSx}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      edge="end"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      disabled={working}
                      sx={{ width: 44, height: 44 }}
                    >
                      {showPassword ? <VisibilityOffOutlinedIcon /> : <VisibilityOutlinedIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            {testResult?.connected ? (
              <Alert severity="success" role="status">Подключение к базе {testResult.configuration} работает.</Alert>
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
        <DialogActions
          sx={{
            px: { xs: 2, sm: 3 },
            pt: 1.5,
            pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', sm: 2.5 },
            gap: 1,
            flexDirection: { xs: 'column-reverse', sm: 'row' },
            justifyContent: 'flex-end',
            '& > :not(style) ~ :not(style)': { ml: 0 },
            '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, minHeight: 46 },
          }}
        >
          <Button onClick={close} disabled={working}>Отмена</Button>
          <Button variant="outlined" onClick={() => void testConnection()} disabled={working} aria-busy={workingAction === 'test'}>
            {workingAction === 'test' ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
            Проверить подключение
          </Button>
          <Button variant="contained" type="submit" disabled={working} aria-busy={workingAction === 'save'}>
            {workingAction === 'save' ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
            Подключить и сохранить
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function TaskActionDialog({ action, task, working, error, progressLabel = '', mobile, onClose, onConfirm }) {
  const commentInputRef = useRef(null);
  const [comment, setComment] = useState('');
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    if (action) {
      setComment('');
      setAttempted(false);
    }
  }, [action]);
  const commentRequired = action?.comment_mode === 'required';
  const commentMissing = attempted && commentRequired && !comment.trim();
  const actionLabel = String(action?.label || progressLabel || 'Действие').trim() || 'Действие';

  const confirm = () => {
    if (working || !action) return;
    setAttempted(true);
    if (commentRequired && !comment.trim()) {
      commentInputRef.current?.focus();
      return;
    }
    onConfirm(comment.trim());
  };

  return (
    <Dialog open={Boolean(action)} onClose={working ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={mobile}>
      <DialogTitle>{working ? 'Выполнение в 1С' : actionLabel}</DialogTitle>
      <DialogContent>
        {working ? (
          <Stack spacing={2} alignItems="center" sx={{ py: { xs: 3, sm: 4 }, px: 1 }} role="status" aria-live="polite">
            <CircularProgress size={42} />
            <Typography variant="subtitle1" fontWeight={800} textAlign="center">
              {actionLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ textWrap: 'pretty', maxWidth: 360 }}>
              Отправляем действие в 1С и ждём ответ. Не закрывайте окно.
            </Typography>
            {task?.title ? (
              <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ overflowWrap: 'anywhere' }}>
                {task.title}
              </Typography>
            ) : null}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity={action?.code === 'reject' ? 'warning' : 'info'}>
              Задание будет изменено непосредственно в 1С. Автоматической отмены этого действия нет.
            </Alert>
            <Typography variant="body2" fontWeight={700}>{task?.title}</Typography>
            <TextField
              autoFocus={commentRequired}
              inputRef={commentInputRef}
              multiline
              minRows={3}
              label={commentRequired ? 'Комментарий или результат *' : 'Комментарий или результат'}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              inputProps={{ maxLength: 2000, 'aria-required': commentRequired || undefined }}
              error={commentMissing}
              helperText={
                commentMissing
                  ? 'Введите комментарий — без него действие выполнить нельзя.'
                  : (commentRequired ? 'Без комментария действие выполнить нельзя.' : 'Необязательно для этого действия.')
              }
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
        )}
      </DialogContent>
      {working ? null : (
        <DialogActions sx={{ px: 3, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', sm: 2.5 } }}>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="contained"
            color={action?.tone || 'primary'}
            onClick={confirm}
          >
            {actionLabel}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

function DisconnectDialog({ open, mobile, working, onClose, onConfirm }) {
  return (
    <Dialog
      open={open}
      onClose={working ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      fullScreen={mobile}
      PaperProps={{ sx: { borderRadius: mobile ? 0 : 3, overscrollBehavior: 'contain' } }}
    >
      <DialogTitle sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 28px)', sm: 3 } }}>
        Отключить 1С?
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Typography variant="body2" color="text.secondary" sx={{ textWrap: 'pretty' }}>
          Сохранённые данные подключения будут удалены. Задания перестанут загружаться, пока снова не подключитесь.
        </Typography>
      </DialogContent>
      <DialogActions
        sx={{
          px: { xs: 2, sm: 3 },
          pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', sm: 2.5 },
          gap: 1,
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          '& > :not(style) ~ :not(style)': { ml: 0 },
          '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, minHeight: 44 },
        }}
      >
        <Button onClick={onClose} disabled={working}>Отмена</Button>
        <Button color="error" variant="contained" onClick={onConfirm} disabled={working} aria-busy={working}>
          {working ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
          Отключить 1С
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
  const documentInputRef = useRef(null);
  const assigneeInputRef = useRef(null);
  const controllerInputRef = useRef(null);
  const titleInputRef = useRef(null);
  const descriptionInputRef = useRef(null);
  const dueAtInputRef = useRef(null);
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
  const [controllerOptions, setControllerOptions] = useState([]);
  const [documentSearch, setDocumentSearch] = useState('');
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [controllerSearch, setControllerSearch] = useState('');
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [loadingAssignees, setLoadingAssignees] = useState(false);
  const [loadingControllers, setLoadingControllers] = useState(false);
  const [working, setWorking] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState(null);
  const [documentHint, setDocumentHint] = useState(null);
  const [assigneeHint, setAssigneeHint] = useState(null);
  const [controllerHint, setControllerHint] = useState(null);
  const [command, setCommand] = useState(null);
  const idempotencyKey = useRef('');

  const readDocumentQuery = () => (
    String(documentInputRef.current?.value || documentSearch || '').trim()
  );

  const searchDocuments = useCallback(async (query = '') => {
    const normalized = String(query || '').trim();
    if (normalized.length < ASSIGNMENT_DOC_SEARCH_MIN) {
      setDocumentOptions([]);
      setDocumentHint(`Введите не менее ${ASSIGNMENT_DOC_SEARCH_MIN} символов для поиска документов.`);
      return;
    }
    setDocumentSearch(normalized);
    setLoadingDocuments(true);
    setError(null);
    setDocumentHint(null);
    try {
      const documents = await docflowAPI.searchAssignmentDocuments({ q: normalized, limit: 20 });
      setDocumentOptions(Array.isArray(documents?.items) ? documents.items : []);
      if (documents?.reason) {
        setDocumentHint(String(documents.reason));
      } else if (documents?.truncated) {
        setDocumentHint('Показаны первые результаты — уточните название или номер.');
      }
    } catch (requestError) {
      setDocumentOptions([]);
      setError(resolveDocflowError(
        requestError,
        '1С не успела ответить — уточните название или номер и повторите поиск.',
      ));
    } finally {
      setLoadingDocuments(false);
    }
  }, []);

  const searchAssignees = useCallback(async (query = '') => {
    setLoadingAssignees(true);
    setError(null);
    setAssigneeHint(null);
    try {
      const assignees = await docflowAPI.searchAssignmentAssignees({ q: query, limit: 20 });
      setAssigneeOptions(Array.isArray(assignees?.items) ? assignees.items : []);
      if (assignees?.reason || assignees?.truncated) {
        setAssigneeHint(String(assignees?.reason || 'Показаны первые результаты — уточните ФИО.'));
      }
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось загрузить исполнителей из 1С.'));
    } finally {
      setLoadingAssignees(false);
    }
  }, []);

  const searchControllers = useCallback(async (query = '') => {
    setLoadingControllers(true);
    setError(null);
    setControllerHint(null);
    try {
      const controllers = await docflowAPI.searchAssignmentAssignees({ q: query, limit: 20 });
      setControllerOptions(Array.isArray(controllers?.items) ? controllers.items : []);
      if (controllers?.reason || controllers?.truncated) {
        setControllerHint(String(controllers?.reason || 'Показаны первые результаты — уточните ФИО.'));
      }
    } catch (requestError) {
      setError(resolveDocflowError(requestError, 'Не удалось загрузить контролёров из 1С.'));
    } finally {
      setLoadingControllers(false);
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
    setControllerSearch('');
    setDocumentOptions([]);
    setAssigneeOptions([]);
    setControllerOptions([]);
    setDocumentHint(null);
    setAssigneeHint(null);
    setControllerHint(null);
    setError(null);
    setCommand(null);
    setAttempted(false);
    void (async () => {
      setLoadingAssignees(true);
      setLoadingControllers(true);
      setError(null);
      try {
        const assignees = await docflowAPI.searchAssignmentAssignees({ q: '', limit: 20 });
        const items = Array.isArray(assignees?.items) ? assignees.items : [];
        setAssigneeOptions(items);
        setControllerOptions(items);
        if (assignees?.reason || assignees?.truncated) {
          const hint = String(assignees?.reason || 'Показаны первые результаты — уточните ФИО.');
          setAssigneeHint(hint);
          setControllerHint(hint);
        }
      } catch (requestError) {
        setError(resolveDocflowError(requestError, 'Не удалось загрузить исполнителей из 1С.'));
      } finally {
        setLoadingAssignees(false);
        setLoadingControllers(false);
      }
    })();
  }, [initialTitle, open]);

  const titleReady = draft.title.trim().length > (testOnly ? requiredTitlePrefix.length : 0);
  const documentMissing = attempted && !draft.document;
  const assigneeMissing = attempted && !draft.assignee;
  const dueAtMissing = attempted && !draft.dueAt;
  const titleMissing = attempted && !titleReady;
  const descriptionMissing = attempted && !draft.description.trim();

  const submit = async () => {
    if (working || command) return;
    setAttempted(true);
    if (!draft.document) {
      documentInputRef.current?.focus();
      return;
    }
    if (!draft.assignee) {
      assigneeInputRef.current?.focus();
      return;
    }
    if (!draft.dueAt) {
      dueAtInputRef.current?.focus();
      return;
    }
    if (!titleReady) {
      titleInputRef.current?.focus();
      return;
    }
    if (!draft.description.trim()) {
      descriptionInputRef.current?.focus();
      return;
    }
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

  const searchFieldRowSx = {
    direction: { xs: 'column', sm: 'row' },
    spacing: 1,
    alignItems: { sm: 'flex-start' },
  };

  const findButtonSx = {
    minHeight: { xs: 40, sm: 40 },
    minWidth: { sm: 96 },
    alignSelf: { xs: 'stretch', sm: 'flex-start' },
    mt: { sm: 0.25 },
  };

  return (
    <Dialog
      open={open}
      onClose={working ? undefined : onClose}
      fullWidth
      maxWidth="md"
      fullScreen={mobile}
      PaperProps={{
        sx: {
          borderRadius: mobile ? 0 : 3,
          overscrollBehavior: 'contain',
          minHeight: mobile ? '100dvh' : undefined,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle
        sx={{
          px: { xs: 2, sm: 3 },
          pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 20px)', sm: 3 },
          pb: 1,
          flexShrink: 0,
        }}
      >
        Создать поручение по документу 1С
      </DialogTitle>
      <DialogContent
        sx={{
          px: { xs: 2, sm: 3 },
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        <Stack spacing={2.25} sx={{ pt: 0.5, pb: 1 }}>
          <Alert severity="info" sx={{ '& .MuiAlert-message': { textWrap: 'pretty' } }}>
            Документ должен уже существовать в 1С — здесь его только выбирают.
            {testOnly
              ? ' Пилот: одно поручение одному исполнителю; после отправки повтор отключён.'
              : ' После отправки повторное создание отключено.'}
          </Alert>

          <Stack spacing={1.25}>
            <Typography variant="subtitle2" fontWeight={800}>Документ</Typography>
            <Stack {...searchFieldRowSx}>
              <Autocomplete
                fullWidth
                size="small"
                options={documentOptions}
                value={draft.document}
                onChange={(_, value) => setDraft((current) => ({ ...current, document: value }))}
                onInputChange={(_, value, reason) => {
                  if (reason === 'input' || reason === 'clear') setDocumentSearch(value);
                }}
                getOptionLabel={(option) => `${option.title}${option.number ? ` · ${option.number}` : ''}`}
                isOptionEqualToValue={(option, value) => option.ref === value.ref}
                loading={loadingDocuments}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const query = readDocumentQuery();
                    if (query.length >= ASSIGNMENT_DOC_SEARCH_MIN) void searchDocuments(query);
                    else {
                      setDocumentHint(`Введите не менее ${ASSIGNMENT_DOC_SEARCH_MIN} символов для поиска документов.`);
                    }
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    inputRef={documentInputRef}
                    label="Документ 1С"
                    required
                    error={documentMissing}
                    helperText={
                      documentMissing
                        ? 'Выберите документ 1С.'
                        : (documentHint || `Введите не менее ${ASSIGNMENT_DOC_SEARCH_MIN} символов и нажмите «Найти».`)
                    }
                  />
                )}
                renderOption={(props, option) => (
                  <li {...props} key={`${option.document_type}-${option.ref}`}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700} noWrap>{option.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.document_type_label}{option.number ? ` · ${option.number}` : ''}
                      </Typography>
                    </Box>
                  </li>
                )}
              />
              <Button
                variant="outlined"
                onClick={() => {
                  const query = readDocumentQuery();
                  if (query.length < ASSIGNMENT_DOC_SEARCH_MIN) {
                    setDocumentHint(`Введите не менее ${ASSIGNMENT_DOC_SEARCH_MIN} символов для поиска документов.`);
                    return;
                  }
                  void searchDocuments(query);
                }}
                disabled={loadingDocuments}
                startIcon={loadingDocuments ? <CircularProgress size={14} color="inherit" /> : <SearchOutlinedIcon />}
                sx={findButtonSx}
              >
                Найти
              </Button>
            </Stack>
          </Stack>

          <Stack spacing={1.25}>
            <Typography variant="subtitle2" fontWeight={800}>Исполнители</Typography>
            <Stack {...searchFieldRowSx}>
              <Autocomplete
                fullWidth
                size="small"
                options={assigneeOptions}
                value={draft.assignee}
                onChange={(_, value) => setDraft((current) => ({ ...current, assignee: value }))}
                inputValue={assigneeSearch}
                onInputChange={(_, value) => setAssigneeSearch(value)}
                getOptionLabel={(option) => option.name || ''}
                isOptionEqualToValue={(option, value) => option.ref === value.ref}
                loading={loadingAssignees}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void searchAssignees(assigneeSearch);
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    inputRef={assigneeInputRef}
                    label="Исполнитель"
                    required
                    error={assigneeMissing}
                    helperText={
                      assigneeMissing
                        ? 'Выберите исполнителя.'
                        : (assigneeHint || 'Введите ФИО и нажмите «Найти». Показаны первые совпадения.')
                    }
                  />
                )}
                renderOption={(props, option) => (
                  <li {...props} key={option.ref}>
                    <Box>
                      <Typography variant="body2" fontWeight={700}>{option.name}</Typography>
                      {option.department ? (
                        <Typography variant="caption" color="text.secondary">{option.department}</Typography>
                      ) : null}
                    </Box>
                  </li>
                )}
              />
              <Button
                variant="outlined"
                onClick={() => void searchAssignees(assigneeSearch)}
                disabled={loadingAssignees}
                startIcon={loadingAssignees ? <CircularProgress size={14} color="inherit" /> : <SearchOutlinedIcon />}
                sx={findButtonSx}
              >
                Найти
              </Button>
            </Stack>
            <Stack {...searchFieldRowSx}>
              <Autocomplete
                fullWidth
                size="small"
                options={controllerOptions}
                value={draft.controller}
                onChange={(_, value) => setDraft((current) => ({ ...current, controller: value }))}
                inputValue={controllerSearch}
                onInputChange={(_, value) => setControllerSearch(value)}
                getOptionLabel={(option) => option.name || ''}
                isOptionEqualToValue={(option, value) => option.ref === value.ref}
                loading={loadingControllers}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void searchControllers(controllerSearch);
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    inputRef={controllerInputRef}
                    label="Контролёр (необязательно)"
                    helperText={controllerHint || 'При необходимости найдите контролёра отдельно.'}
                  />
                )}
                renderOption={(props, option) => (
                  <li {...props} key={`controller-${option.ref}`}>
                    <Box>
                      <Typography variant="body2" fontWeight={700}>{option.name}</Typography>
                      {option.department ? (
                        <Typography variant="caption" color="text.secondary">{option.department}</Typography>
                      ) : null}
                    </Box>
                  </li>
                )}
              />
              <Button
                variant="outlined"
                onClick={() => void searchControllers(controllerSearch)}
                disabled={loadingControllers}
                startIcon={loadingControllers ? <CircularProgress size={14} color="inherit" /> : <SearchOutlinedIcon />}
                sx={findButtonSx}
              >
                Найти
              </Button>
            </Stack>
          </Stack>

          <Stack spacing={1.25}>
            <Typography variant="subtitle2" fontWeight={800}>Срок и важность</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                fullWidth
                size="small"
                type="datetime-local"
                label="Срок исполнения"
                value={draft.dueAt}
                onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
                InputLabelProps={{ shrink: true }}
                inputRef={dueAtInputRef}
                required
                error={dueAtMissing}
                helperText={dueAtMissing ? 'Укажите срок исполнения.' : undefined}
              />
              <TextField
                fullWidth
                size="small"
                select
                label="Важность"
                value={draft.importance}
                onChange={(event) => setDraft((current) => ({ ...current, importance: event.target.value }))}
              >
                <MenuItem value="normal">Обычная</MenuItem>
                <MenuItem value="high">Высокая</MenuItem>
              </TextField>
            </Stack>
          </Stack>

          <Stack spacing={1.25}>
            <Typography variant="subtitle2" fontWeight={800}>Текст поручения</Typography>
            <TextField
              size="small"
              label="Название поручения"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              inputRef={titleInputRef}
              inputProps={{ maxLength: 200 }}
              error={titleMissing}
              helperText={
                titleMissing
                  ? (testOnly ? `Название должно начинаться с ${requiredTitlePrefix} и содержать текст после префикса.` : 'Укажите название поручения.')
                  : (testOnly ? `Название должно начинаться с ${requiredTitlePrefix}.` : 'Укажите понятное название поручения для исполнителя.')
              }
              required
            />
            <TextField
              size="small"
              multiline
              minRows={mobile ? 3 : 4}
              label="Описание поручения"
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              inputRef={descriptionInputRef}
              inputProps={{ maxLength: 2000 }}
              error={descriptionMissing}
              helperText={descriptionMissing ? 'Добавьте описание для исполнителя.' : undefined}
              required
            />
          </Stack>

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
      <DialogActions
        sx={{
          px: { xs: 2, sm: 3 },
          pt: 1.25,
          pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', sm: 2.5 },
          gap: 1,
          flexShrink: 0,
          borderTop: 1,
          borderColor: 'divider',
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          '& > :not(style) ~ :not(style)': { ml: 0 },
          '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, minHeight: 44 },
        }}
      >
        <Button onClick={onClose} disabled={working}>Закрыть</Button>
        {!command ? (
          <Button variant="contained" onClick={() => void submit()} disabled={working} aria-busy={working}>
            {working ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
            Создать в 1С
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
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectWorking, setDisconnectWorking] = useState(false);
  const [profileMenuAnchor, setProfileMenuAnchor] = useState(null);
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
  const [taskFilesLoading, setTaskFilesLoading] = useState(false);
  const [taskDetailError, setTaskDetailError] = useState(null);
  const [fileActionError, setFileActionError] = useState(null);
  const [taskAction, setTaskAction] = useState(null);
  const [taskActionWorking, setTaskActionWorking] = useState(false);
  const [taskActionError, setTaskActionError] = useState(null);
  const [taskActionNotice, setTaskActionNotice] = useState(null);
  const [actionProgressLabel, setActionProgressLabel] = useState('');
  const [commandState, setCommandState] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(createEmptyAttachmentPreview);
  const [credentialsRevision, setCredentialsRevision] = useState(0);
  const requestSequence = useRef(0);
  const loadedRequestKey = useRef('');
  const inFlightRequest = useRef(null);
  const tasksLengthRef = useRef(0);
  const selectedTaskRef = useRef('');
  const detailCache = useRef(new Map());
  const detailInFlight = useRef(new Map());
  const commandCheckInFlight = useRef(false);
  const previewSequence = useRef(0);
  const previewObjectUrl = useRef('');
  tasksLengthRef.current = tasks.length;

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

  const loadTasks = useCallback((options = {}) => {
    const force = Boolean(options?.force);
    if (!profile?.configured) {
      setTasks([]);
      setTasksError(null);
      return Promise.resolve();
    }
    const login = String(profile?.login || '').trim();
    const requestKey = `${credentialsRevision}|${scope}|${search}`;
    if (!force && inFlightRequest.current?.key === requestKey) {
      return inFlightRequest.current.promise;
    }
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const sameParameters = loadedRequestKey.current === requestKey;
    let usedCache = false;

    if (!force) {
      const cached = readDocflowTasksCache({ login, scope, search });
      if (cached) {
        usedCache = true;
        loadedRequestKey.current = requestKey;
        setTasks(cached.items);
        setTruncated(cached.truncated);
        setLastUpdatedAt(cached.as_of);
        setTasksError(null);
        if (!sameParameters) {
          setSelectedTask(null);
          selectedTaskRef.current = '';
          setTaskDetailLoading(false);
          setTaskDetailError(null);
          setFileActionError(null);
        }
        // Свежий кэш — сразу отдаём; иначе stale-while-revalidate (список уже на экране).
        if (isDocflowTasksCacheFresh(cached)) {
          setTasksLoading(false);
          return Promise.resolve(cached);
        }
      }
    }

    if (!sameParameters && !usedCache) {
      setSelectedTask(null);
      selectedTaskRef.current = '';
      setTaskDetailLoading(false);
      setTaskDetailError(null);
      setFileActionError(null);
      if (!tasksLengthRef.current) setTruncated(false);
    }
    setTasksLoading(true);
    setTasksError(null);

    let promise;
    promise = (async () => {
      try {
        const result = await docflowAPI.listTasks({ scope, q: search, limit: 50 });
        if (requestSequence.current !== requestId) return;
        loadedRequestKey.current = requestKey;
        const items = Array.isArray(result?.items) ? result.items : [];
        const nextTruncated = Boolean(result?.truncated);
        const asOf = String(result?.as_of || '');
        setTasks(items);
        setTruncated(nextTruncated);
        setLastUpdatedAt(asOf);
        writeDocflowTasksCache({
          login,
          scope,
          search,
          items,
          truncated: nextTruncated,
          as_of: asOf,
        });
      } catch (error) {
        if (requestSequence.current !== requestId) return;
        const resolved = resolveDocflowError(error, 'Не удалось загрузить задания из 1С.');
        if (!usedCache && !sameParameters && !tasksLengthRef.current) setTasks([]);
        if (
          resolved.code === 'DOCFLOW_AUTH_FAILED'
          || resolved.code === 'DOCFLOW_CREDENTIALS_INVALID'
          || resolved.code === 'DOCFLOW_UNAUTHORIZED'
        ) {
          clearDocflowTasksCacheByLogin(login);
        }
        // При soft-revalidate сохраняем кэш на экране и не пугаем ошибкой сети.
        if (force || !usedCache) setTasksError(resolved);
      } finally {
        if (inFlightRequest.current?.promise === promise) inFlightRequest.current = null;
        if (requestSequence.current === requestId) setTasksLoading(false);
      }
    })();
    inFlightRequest.current = { key: requestKey, promise };
    return promise;
  }, [credentialsRevision, profile?.configured, profile?.login, scope, search]);

  const loadTaskDetail = useCallback((task, { force = false } = {}) => {
    const taskRef = String(task?.ref || '').trim();
    if (!taskRef) return Promise.resolve(null);
    if (force) detailCache.current.delete(taskRef);
    const cached = detailCache.current.get(taskRef);
    if (cached) {
      if (selectedTaskRef.current === taskRef) {
        setSelectedTask(cached);
        setTaskDetailLoading(false);
        setTaskFilesLoading(false);
        setTaskDetailError(null);
      }
      return Promise.resolve(cached);
    }
    const existing = detailInFlight.current.get(taskRef);
    if (existing) return existing;
    if (selectedTaskRef.current === taskRef) {
      setTaskDetailLoading(true);
      setTaskFilesLoading(true);
      setTaskDetailError(null);
    }
    let promise;
    promise = (async () => {
      try {
        const core = await docflowAPI.getTask(taskRef, { includeRelated: false });
        if (selectedTaskRef.current === taskRef) {
          setSelectedTask(core);
          setTaskDetailError(null);
          setTaskDetailLoading(false);
        }
        try {
          const detail = await docflowAPI.getTask(taskRef, { includeRelated: true });
          rememberDetail(detailCache.current, taskRef, detail);
          if (selectedTaskRef.current === taskRef) {
            setSelectedTask(detail);
            setTaskDetailError(null);
            if (detail?.files_incomplete) {
              setFileActionError({
                code: 'docflow_files_partial',
                message: 'Список файлов из связанных документов 1С загрузился не полностью. Обновите карточку или откройте документ в 1С.',
                correlationId: '',
              });
            }
          }
          return detail;
        } catch (enrichError) {
          rememberDetail(detailCache.current, taskRef, core);
          if (selectedTaskRef.current === taskRef) {
            setFileActionError(resolveDocflowError(
              enrichError,
              'Не удалось загрузить файлы карточки из 1С. Описание доступно; повторите обновление карточки.',
            ));
          }
          return core;
        }
      } catch (error) {
        if (selectedTaskRef.current === taskRef) {
          setTaskDetailError(resolveDocflowError(error, 'Не удалось загрузить подробную карточку задания.'));
        }
        return null;
      } finally {
        if (detailInFlight.current.get(taskRef) === promise) detailInFlight.current.delete(taskRef);
        if (selectedTaskRef.current === taskRef) {
          setTaskDetailLoading(false);
          setTaskFilesLoading(false);
        }
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
    setTaskFilesLoading(false);
    setTaskDetailError(null);
    setFileActionError(null);
    setTaskAction(null);
    setTaskActionError(null);
    setTaskActionNotice(null);
    setActionProgressLabel('');
    setCommandState(null);
  }, []);

  const applySelectedTaskAction = useCallback(async (comment) => {
    const taskRef = String(selectedTask?.ref || '').trim();
    const stateToken = String(selectedTask?.state_token || '').trim();
    if (!taskRef || !stateToken || !taskAction) return;
    const actionLabel = String(taskAction.label || 'Действие').trim() || 'Действие';
    setActionProgressLabel(actionLabel);
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
        detailInFlight.current.delete(taskRef);
        const optimisticTask = buildCompletedTaskSnapshot(result.task || selectedTask, taskRef);
        rememberDetail(detailCache.current, taskRef, optimisticTask);
        if (selectedTaskRef.current === taskRef) setSelectedTask(optimisticTask);
        setTaskAction(null);
        setCommandState(null);
        setTaskActionNotice({ severity: 'success', message: '1С подтвердила выполнение задания.' });
        const login = String(profile?.login || '').trim();
        patchDocflowTasksCacheAfterCompletion({ login, task: optimisticTask, search });
        // Move the task before the enrichment refresh. That refresh is optional
        // and can take several seconds while 1C loads related objects.
        setTasks((prev) => updateTaskListAfterCompletion(prev, optimisticTask, scope));
        try {
          const refreshed = await loadTaskDetail({ ref: taskRef }, { force: true });
          if (selectedTaskRef.current === taskRef) {
            const merged = keepCompletedIfStale(refreshed, optimisticTask);
            rememberDetail(detailCache.current, taskRef, merged);
            setSelectedTask(merged);
          }
        } catch {
          // Keep optimistic completed state if force refresh fails.
        }
        // #region agent log
        fetch('http://127.0.0.1:7785/ingest/0b41f4b9-4bc6-4338-b7ef-ba558019ce59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3272c'},body:JSON.stringify({sessionId:'b3272c',runId:'history-policy',hypothesisId:'H-HIST',location:'Docflow.jsx:applySelectedTaskAction',message:'after_action_refresh_policy',data:{scope,heavy:isHeavyDocflowTasksScope(scope),taskRef:taskRef.slice(0,80)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        setActionProgressLabel('');
      } else {
        setTaskAction(null);
        setCommandState(result);
        // 202/state_unknown: immediately re-check once the spinner is free (finally clears working).
        if (result?.status === 'state_unknown' || result?.status === 'pending') {
          // #region agent log
          fetch('http://127.0.0.1:7785/ingest/0b41f4b9-4bc6-4338-b7ef-ba558019ce59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3272c'},body:JSON.stringify({sessionId:'b3272c',runId:'measure-202-check',hypothesisId:'H-TIME',location:'Docflow.jsx:applySelectedTaskAction',message:'schedule_immediate_202_check',data:{status:result?.status,commandId:String(result?.command_id||'').slice(0,40)},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
      }
    } catch (error) {
      const resolved = resolveDocflowError(error, 'Не удалось выполнить действие в 1С.');
      if (resolved.code === 'DOCFLOW_DIGITAL_SIGNATURE_REQUIRED') {
        const nextTask = {
          ...selectedTask,
          requires_digital_signature: true,
          available_actions: [],
          action_unavailable_reason: 'Для этого задания требуется электронная подпись. Выполните действие в 1С.',
        };
        rememberDetail(detailCache.current, taskRef, nextTask);
        if (selectedTaskRef.current === taskRef) setSelectedTask(nextTask);
        setTaskAction(null);
        setActionProgressLabel('');
        setTaskActionNotice({ severity: 'info', message: resolved.message });
      } else {
        setTaskActionError(resolved);
      }
    } finally {
      setTaskActionWorking(false);
    }
  }, [loadTaskDetail, profile?.login, scope, search, selectedTask, taskAction]);

  const checkTaskCommand = useCallback(async (requestedCommandId) => {
    const commandId = String(requestedCommandId || '').trim();
    if (!commandId || commandCheckInFlight.current) return;
    commandCheckInFlight.current = true;
    setTaskActionWorking(true);
    setTaskActionNotice(null);
    setActionProgressLabel((current) => current || 'Проверка в 1С');
    try {
      const result = await docflowAPI.getCommand(commandId);
      setCommandState(result);
      if (result?.status === 'applied' || result?.status === 'already_applied') {
        const taskRef = String(result.task?.ref || selectedTaskRef.current || '').trim();
        if (taskRef) {
          detailInFlight.current.delete(taskRef);
          const optimisticTask = buildCompletedTaskSnapshot(
            result.task || detailCache.current.get(taskRef),
            taskRef,
          );
          rememberDetail(detailCache.current, taskRef, optimisticTask);
          if (selectedTaskRef.current === taskRef) setSelectedTask(optimisticTask);
          setCommandState(null);
          setTaskActionNotice({ severity: 'success', message: '1С подтвердила выполнение задания.' });
          const login = String(profile?.login || '').trim();
          patchDocflowTasksCacheAfterCompletion({ login, task: optimisticTask, search });
          setTasks((prev) => updateTaskListAfterCompletion(prev, optimisticTask, scope));
          try {
            const refreshed = await loadTaskDetail({ ref: taskRef }, { force: true });
            if (selectedTaskRef.current === taskRef) {
              const merged = keepCompletedIfStale(refreshed, optimisticTask);
              rememberDetail(detailCache.current, taskRef, merged);
              setSelectedTask(merged);
            }
          } catch {
            // Keep optimistic completed state if force refresh fails.
          }
        } else {
          setCommandState(null);
          setTaskActionNotice({ severity: 'success', message: '1С подтвердила выполнение задания.' });
        }
        // #region agent log
        fetch('http://127.0.0.1:7785/ingest/0b41f4b9-4bc6-4338-b7ef-ba558019ce59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3272c'},body:JSON.stringify({sessionId:'b3272c',runId:'history-policy',hypothesisId:'H-HIST',location:'Docflow.jsx:checkTaskCommand',message:'after_command_refresh_policy',data:{scope,heavy:isHeavyDocflowTasksScope(scope)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        setActionProgressLabel('');
      } else if (result?.status === 'rejected' && result?.error_code === 'DOCFLOW_ACTION_NOT_APPLIED') {
        const nextTask = result.task;
        if (nextTask?.ref) {
          rememberDetail(detailCache.current, nextTask.ref, nextTask);
          if (selectedTaskRef.current === nextTask.ref) setSelectedTask(nextTask);
        }
        setCommandState(null);
        setActionProgressLabel('');
        setTaskActionNotice({
          severity: 'warning',
          message: '1С не применила действие. Карточка обновлена — действие можно выполнить заново.',
        });
      }
    } catch (error) {
      const resolved = resolveDocflowError(error, 'Не удалось проверить состояние команды в 1С.');
      setTaskActionNotice({ severity: 'error', message: resolved.message });
    } finally {
      commandCheckInFlight.current = false;
      setTaskActionWorking(false);
    }
  }, [loadTaskDetail, profile?.login, scope, search]);

  useEffect(() => {
    const status = String(commandState?.status || '');
    const commandId = String(commandState?.command_id || '').trim();
    if (!commandId || (status !== 'state_unknown' && status !== 'pending')) return undefined;
    // #region agent log
    fetch('http://127.0.0.1:7785/ingest/0b41f4b9-4bc6-4338-b7ef-ba558019ce59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3272c'},body:JSON.stringify({sessionId:'b3272c',runId:'stuck-approve',hypothesisId:'H5',location:'Docflow.jsx:autoPollCommand',message:'start_auto_poll',data:{status,commandId:commandId.slice(0,40)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let cancelled = false;
    const tick = () => {
      if (cancelled || commandCheckInFlight.current) return;
      void checkTaskCommand(commandId);
    };
    // Give the original request time to settle, then poll at a stable cadence.
    const timer = window.setInterval(tick, 3000);
    const first = window.setTimeout(tick, 750);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [checkTaskCommand, commandState?.command_id, commandState?.status]);

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
        const metadata = await waitForAttachmentPreview({
          previewAPI: {
            getAttachmentPreview: (_taskRef, _fileRef, { signal } = {}) => (
              docflowAPI.getFilePreview(taskRef, fileRef, { signal })
            ),
          },
          parentId: taskRef,
          attachmentId: fileRef,
        });
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
          sourceKind: String(metadata?.source_kind || response?.headers?.['x-docflow-preview-source-kind'] || officeSourceKind),
          objectUrl,
          previewBlob: blob,
          pdfFilename: String(metadata?.pdf_filename || pdfFilename),
          pageCount: Number(metadata?.page_count || response?.headers?.['x-docflow-preview-page-count'] || 0),
          sheets: Array.isArray(metadata?.sheets) ? metadata.sheets : [],
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
    if (!profile?.configured) return undefined;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      // Inbox must stay fresh; completed/all are on-demand and expensive in 1С.
      if (isHeavyDocflowTasksScope(scope)) {
        // #region agent log
        fetch('http://127.0.0.1:7785/ingest/0b41f4b9-4bc6-4338-b7ef-ba558019ce59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3272c'},body:JSON.stringify({sessionId:'b3272c',runId:'history-policy',hypothesisId:'H-HIST',location:'Docflow.jsx:visibility',message:'skip_heavy_scope_refresh',data:{scope},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return;
      }
      // #region agent log
      fetch('http://127.0.0.1:7785/ingest/0b41f4b9-4bc6-4338-b7ef-ba558019ce59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3272c'},body:JSON.stringify({sessionId:'b3272c',runId:'history-policy',hypothesisId:'H-HIST',location:'Docflow.jsx:visibility',message:'refresh_inbox_on_visible',data:{scope},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      void loadTasks({ force: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [loadTasks, profile?.configured, scope]);

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
    setDisconnectWorking(true);
    try {
      await docflowAPI.deleteCredentials();
      clearAllDocflowTasksCache();
      setTasks([]);
      closeTask();
      closeAttachmentPreview();
      detailCache.current.clear();
      detailInFlight.current.clear();
      loadedRequestKey.current = '';
      setProfile({ configured: false, login: null, status: 'not_configured' });
      setDisconnectOpen(false);
    } catch (error) {
      setProfileError(resolveDocflowError(error, 'Не удалось удалить данные подключения 1С.'));
    } finally {
      setDisconnectWorking(false);
    }
  };

  const profileStatus = PROFILE_STATUS[profile?.status] || PROFILE_STATUS.configured;
  const visibleTasks = useMemo(
    () => filterDocflowTasks(tasks, searchDraft || search),
    [tasks, searchDraft, search],
  );
  const hasActiveSearch = Boolean(String(searchDraft || search || '').trim());

  return (
    <MainLayout>
      <PageShell fullHeight sx={{ gap: { xs: 1, sm: 1.5 }, pb: { xs: 1, sm: 1.5 } }}>
        {isMobile ? (
          <MobileShellPageHeader
            title="1С · Документооборот"
            sx={{ mb: 0, flexShrink: 0, minHeight: 40 }}
          />
        ) : null}
        <Stack spacing={{ xs: 1, sm: 1.5 }} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Stack
            direction={{ sm: 'row' }}
            spacing={1.5}
            justifyContent="space-between"
            alignItems="center"
            sx={{ display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}
          >
            <Box>
              <Typography variant="h5" fontWeight={800}>Документооборот</Typography>
            </Box>
          </Stack>

          {profileError ? (
            <Alert severity="error" sx={{ flexShrink: 0 }} action={<Button color="inherit" size="small" onClick={() => void loadProfile()}>Повторить</Button>}>
              {profileError.message}
            </Alert>
          ) : null}

          {assignmentNotice ? (
            <Alert severity={assignmentNotice.severity || 'success'} sx={{ flexShrink: 0 }} onClose={() => setAssignmentNotice(null)}>
              {assignmentNotice.message}
            </Alert>
          ) : null}

          {!profileLoading && !profileError && !profile?.configured ? (
            <Alert severity="info" sx={{ flexShrink: 0 }}>
              Введите личные данные 1С, чтобы увидеть только назначенные вам задания.
            </Alert>
          ) : null}

          <Paper
            elevation={0}
            sx={{
              borderRadius: { xs: 2, sm: 3 },
              overflow: 'hidden',
              minWidth: 0,
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
            }}
          >
            <Stack
              direction="row"
              spacing={0.85}
              alignItems="center"
              sx={{
                px: { xs: 1.1, sm: 1.75 },
                py: { xs: 0.85, sm: 1.15 },
                flexShrink: 0,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: (themeValue) => (
                  themeValue.palette.mode === 'dark'
                    ? 'rgba(255,255,255,0.03)'
                    : 'rgba(15,23,42,0.02)'
                ),
              }}
            >
              <Box
                sx={{
                  width: { xs: 28, sm: 34 },
                  height: { xs: 28, sm: 34 },
                  borderRadius: 1.5,
                  bgcolor: profile?.configured ? 'primary.main' : 'action.disabledBackground',
                  color: profile?.configured ? 'primary.contrastText' : 'text.disabled',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                <AssignmentTurnedInOutlinedIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.65} alignItems="center" useFlexGap flexWrap="wrap">
                  <Typography variant="subtitle2" fontWeight={800} sx={{ lineHeight: 1.15, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>
                    Мои задания
                  </Typography>
                  {!profileLoading ? (
                    <Chip
                      size="small"
                      color={profileStatus.color}
                      label={profileStatus.label}
                      sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
                    />
                  ) : (
                    <Skeleton width={64} height={20} />
                  )}
                </Stack>
                {profileLoading ? (
                  <Skeleton width="50%" height={14} />
                ) : (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: { xs: 'none', sm: 'block' },
                      mt: 0.1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {profile?.configured
                      ? (profile.login || 'пользователь 1С')
                      : 'Подключите учётную запись 1С'}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={0.35} alignItems="center" sx={{ flexShrink: 0 }}>
                {profile?.configured ? (
                  <Tooltip title="Обновить задания">
                    <span>
                      <IconButton
                        onClick={() => void loadTasks({ force: true })}
                        disabled={tasksLoading}
                        aria-label="Обновить задания"
                        size="small"
                        sx={{ width: 30, height: 30, border: 1, borderColor: 'divider' }}
                      >
                        <RefreshOutlinedIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : null}
                {profile?.configured ? (
                  <>
                    <IconButton
                      size="small"
                      aria-label="Ещё действия подключения"
                      aria-haspopup="menu"
                      aria-expanded={Boolean(profileMenuAnchor) ? 'true' : undefined}
                      onClick={(event) => setProfileMenuAnchor(event.currentTarget)}
                      sx={{ width: 30, height: 30, border: 1, borderColor: 'divider' }}
                    >
                      <MoreVertOutlinedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                    <Menu
                      anchorEl={profileMenuAnchor}
                      open={Boolean(profileMenuAnchor)}
                      onClose={() => setProfileMenuAnchor(null)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    >
                      <MenuItem
                        onClick={() => {
                          setProfileMenuAnchor(null);
                          setDialogOpen(true);
                        }}
                      >
                        <ListItemIcon><KeyOutlinedIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Настроить</ListItemText>
                      </MenuItem>
                      {assignmentCapability ? (
                        <Tooltip
                          title={!assignmentCapability.enabled ? (assignmentCapability.reason || 'Создание поручений недоступно.') : ''}
                          disableHoverListener={Boolean(assignmentCapability.enabled)}
                        >
                          <span>
                            <MenuItem
                              disabled={!assignmentCapability.enabled}
                              onClick={() => {
                                setProfileMenuAnchor(null);
                                setAssignmentDialogOpen(true);
                              }}
                            >
                              <ListItemIcon><AddTaskOutlinedIcon fontSize="small" /></ListItemIcon>
                              <ListItemText
                                primary="Создать поручение"
                                secondary={!assignmentCapability.enabled ? (assignmentCapability.reason || 'Недоступно') : undefined}
                                secondaryTypographyProps={{ sx: { maxWidth: 260, whiteSpace: 'normal' } }}
                              />
                            </MenuItem>
                          </span>
                        </Tooltip>
                      ) : null}
                      <MenuItem
                        onClick={() => {
                          setProfileMenuAnchor(null);
                          setDisconnectOpen(true);
                        }}
                      >
                        <ListItemIcon><DeleteOutlineOutlinedIcon fontSize="small" color="error" /></ListItemIcon>
                        <ListItemText>Отключить</ListItemText>
                      </MenuItem>
                    </Menu>
                  </>
                ) : (
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setDialogOpen(true)}
                    disabled={profileLoading}
                    sx={{ minHeight: 30, whiteSpace: 'nowrap', px: 1.25 }}
                  >
                    Подключить
                  </Button>
                )}
              </Stack>
            </Stack>

            {!profileLoading && profile?.configured ? (
              <>
                <Stack spacing={{ xs: 0.75, sm: 1 }} sx={{ px: { xs: 1.1, sm: 1.75 }, pt: { xs: 1, sm: 1.25 }, pb: { xs: 0.85, sm: 1 }, flexShrink: 0 }}>
                  {assignmentCapability ? (
                    assignmentCapability.enabled ? (
                      <Button
                        size="small"
                        startIcon={<AddTaskOutlinedIcon />}
                        variant="outlined"
                        onClick={() => setAssignmentDialogOpen(true)}
                        sx={{ alignSelf: 'flex-start', minHeight: 36 }}
                      >
                        Создать поручение
                      </Button>
                    ) : (
                      <Tooltip title={assignmentCapability.reason || 'Создание поручений недоступно.'}>
                        <span>
                          <Button
                            size="small"
                            startIcon={<AddTaskOutlinedIcon />}
                            variant="outlined"
                            disabled
                            sx={{ alignSelf: 'flex-start', minHeight: 36 }}
                          >
                            Создать поручение
                          </Button>
                        </span>
                      </Tooltip>
                    )
                  ) : null}
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={scope}
                    onChange={(_, value) => value && setScope(value)}
                    disabled={tasksLoading}
                    aria-label="Состав заданий"
                    fullWidth={isMobile}
                    sx={(themeValue) => {
                      const isDark = themeValue.palette.mode === 'dark';
                      const idleText = isDark ? 'rgba(255,255,255,0.78)' : themeValue.palette.text.secondary;
                      const hoverText = isDark ? '#fff' : themeValue.palette.text.primary;
                      const selectedText = isDark ? '#fff' : themeValue.palette.primary.contrastText;
                      const selectedBg = isDark ? 'rgba(255,255,255,0.16)' : themeValue.palette.primary.main;
                      const selectedHoverBg = isDark ? 'rgba(255,255,255,0.22)' : themeValue.palette.primary.dark;
                      const radius = 10;
                      return {
                        alignSelf: { xs: 'stretch', sm: 'flex-start' },
                        maxWidth: '100%',
                        p: 0,
                        gap: 0,
                        borderRadius: `${radius}px`,
                        border: 1,
                        borderColor: 'divider',
                        bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.035)',
                        overflow: 'hidden',
                        '& .MuiToggleButtonGroup-grouped': {
                          border: 0,
                          borderRadius: '0 !important',
                          mx: 0,
                          margin: 0,
                        },
                        '& .MuiToggleButtonGroup-grouped:not(:first-of-type)': {
                          borderLeft: 1,
                          borderColor: 'divider',
                          marginLeft: 0,
                        },
                        '& .MuiToggleButtonGroup-grouped:first-of-type': {
                          borderTopLeftRadius: `${radius}px !important`,
                          borderBottomLeftRadius: `${radius}px !important`,
                        },
                        '& .MuiToggleButtonGroup-grouped:last-of-type': {
                          borderTopRightRadius: `${radius}px !important`,
                          borderBottomRightRadius: `${radius}px !important`,
                        },
                        '& .MuiToggleButton-root': {
                          minHeight: { xs: 30, sm: 32 },
                          px: { xs: 0.5, sm: 1.15 },
                          py: { xs: 0.25, sm: 0.35 },
                          whiteSpace: 'nowrap',
                          fontSize: { xs: '0.7rem', sm: '0.8125rem' },
                          lineHeight: 1.15,
                          fontWeight: 600,
                          textTransform: 'none',
                          color: idleText,
                          bgcolor: 'transparent',
                          opacity: 1,
                          transition: 'background-color 120ms ease, color 120ms ease',
                          '&:hover': {
                            color: hoverText,
                            bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
                          },
                          '&.Mui-selected': {
                            color: selectedText,
                            bgcolor: selectedBg,
                            fontWeight: 700,
                            '&:hover': {
                              color: selectedText,
                              bgcolor: selectedHoverBg,
                            },
                          },
                          '&.Mui-disabled': {
                            color: themeValue.palette.text.disabled,
                            opacity: 0.7,
                          },
                        },
                      };
                    }}
                  >
                    {SCOPE_OPTIONS.map((option) => (
                      <ToggleButton key={option.value} value={option.value}>
                        {option.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  <Box component="form" onSubmit={applySearch} sx={{ display: 'flex', gap: 0.65, minWidth: 0 }}>
                    <TextField
                      size="small"
                      fullWidth
                      label="Поиск"
                      value={searchDraft}
                      onChange={(event) => setSearchDraft(event.target.value)}
                      inputProps={{ maxLength: 200, 'aria-label': 'Поиск по моим заданиям' }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start"><SearchOutlinedIcon sx={{ fontSize: 16 }} /></InputAdornment>
                        ),
                      }}
                      sx={{
                        '& .MuiInputBase-root': { minHeight: { xs: 32, sm: 34 } },
                        '& .MuiInputBase-input': { py: 0.65, fontSize: '0.8125rem' },
                        '& .MuiInputLabel-root': { fontSize: { xs: '0.8125rem', sm: undefined } },
                      }}
                    />
                    <IconButton
                      type="submit"
                      color="primary"
                      disabled={tasksLoading}
                      aria-label="Найти"
                      sx={{
                        width: { xs: 32, sm: 34 },
                        height: { xs: 32, sm: 34 },
                        borderRadius: 1.5,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        flexShrink: 0,
                        '&:hover': { bgcolor: 'primary.dark' },
                        '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
                      }}
                    >
                      <SearchOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Box>
                </Stack>
                <Divider sx={{ flexShrink: 0 }} />

                {visibleTasks.length > 0 || (!tasksLoading && !tasksError && tasks.length > 0 && hasActiveSearch) ? (
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: { xs: 1.1, sm: 1.75 }, py: 0.45, flexShrink: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                      Найдено: {visibleTasks.length}{hasActiveSearch && tasks.length !== visibleTasks.length ? ` из ${tasks.length}` : ''}
                    </Typography>
                    {lastUpdatedAt ? (
                      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.65rem' }}>
                        Обновлено: {formatDocflowDate(lastUpdatedAt) || 'только что из 1С'}
                      </Typography>
                    ) : null}
                  </Stack>
                ) : null}
                {tasksLoading && tasks.length > 0 ? <LinearProgress aria-label="Обновляем задания" sx={{ flexShrink: 0 }} /> : null}

                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    WebkitOverflowScrolling: 'touch',
                    ...hideScrollbarSx,
                  }}
                >
                  {tasksError ? (
                    <Alert
                      severity={tasksError.code === 'DOCFLOW_MAPPING_REQUIRED' ? 'warning' : 'error'}
                      action={<Button color="inherit" size="small" onClick={() => void loadTasks({ force: true })}>Повторить</Button>}
                      sx={{ m: 1.5 }}
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
                    <Stack data-testid="docflow-task-skeleton" spacing={1} sx={{ p: { xs: 1.25, sm: 1.75 } }}>
                      <Typography variant="body2" color="text.secondary">Первое подключение к 1С может занять до минуты…</Typography>
                      {[0, 1, 2].map((item) => (
                        <Box key={item} sx={{ p: 1.15, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                          <Skeleton width={`${82 - item * 9}%`} height={20} />
                          <Skeleton width="44%" />
                          <Skeleton width="66%" />
                        </Box>
                      ))}
                    </Stack>
                  ) : null}

                  {!tasksLoading && !tasksError && visibleTasks.length === 0 ? (
                    <Stack alignItems="center" spacing={1} sx={{ px: 2, py: 6, textAlign: 'center' }}>
                      <AssignmentTurnedInOutlinedIcon color="disabled" sx={{ fontSize: 40 }} />
                      <Typography fontWeight={700}>
                        {hasActiveSearch ? 'Ничего не найдено' : 'Заданий нет'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {hasActiveSearch
                          ? 'Измените запрос или очистите поиск.'
                          : 'В этом разделе сейчас пусто.'}
                      </Typography>
                    </Stack>
                  ) : null}

                  {visibleTasks.length > 0 ? (
                    <>
                      <DocflowTaskList tasks={visibleTasks} onOpen={openTask} />
                      {truncated && !hasActiveSearch ? (
                        <Alert severity="info" sx={{ m: 1.5 }}>Показаны первые 50 заданий. Уточните поиск.</Alert>
                      ) : null}
                    </>
                  ) : null}
                </Box>
              </>
            ) : null}
          </Paper>

        </Stack>
      </PageShell>

      <CredentialDialog
        open={dialogOpen}
        profile={profile}
        mobile={isMobile}
        onClose={() => setDialogOpen(false)}
        onSaved={(nextProfile) => {
          clearAllDocflowTasksCache();
          setProfile(nextProfile);
          detailCache.current.clear();
          detailInFlight.current.clear();
          loadedRequestKey.current = '';
          setCredentialsRevision((value) => value + 1);
          setDialogOpen(false);
        }}
      />
      <DisconnectDialog
        open={disconnectOpen}
        mobile={isMobile}
        working={disconnectWorking}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={() => void removeCredentials()}
      />
      <AssignmentDialog
        open={assignmentDialogOpen}
        mobile={isMobile}
        capability={assignmentCapability}
        onClose={() => setAssignmentDialogOpen(false)}
        onCreated={(result) => {
          setAssignmentDialogOpen(false);
          const processRef = String(result?.assignment?.process_ref || '').trim();
          const taskRef = String(result?.assignment?.task_ref || '').trim();
          setAssignmentNotice({
            severity: 'success',
            message: processRef
              ? `1С подтвердила создание поручения. Процесс: ${processRef}${taskRef ? ` · задание: ${taskRef}` : ''}`
              : '1С подтвердила создание поручения.',
            processRef,
            taskRef,
          });
          void loadTasks({ force: true });
        }}
      />
      <DocflowTaskDetails
        task={selectedTask}
        mobile={isMobile}
        loading={taskDetailLoading}
        filesLoading={taskFilesLoading}
        error={taskDetailError}
        fileError={fileActionError}
        actionNotice={taskActionNotice}
        actionWorking={taskActionWorking}
        actionProgressLabel={actionProgressLabel}
        commandState={commandState}
        onRetry={() => void loadTaskDetail(selectedTask, { force: true })}
        onRefresh={() => void loadTaskDetail(selectedTask, { force: true })}
        onPreviewFile={(task, file) => void openAttachmentPreview(task, file)}
        onDownloadFile={(task, file) => void downloadTaskFile(task, file)}
        onAction={(action) => {
          setTaskActionError(null);
          setActionProgressLabel(String(action?.label || '').trim());
          setTaskAction({ ...action, idempotencyKey: createIdempotencyKey() });
        }}
        onCheckCommand={() => void checkTaskCommand(commandState?.command_id)}
        onClose={closeTask}
      />
      <TaskActionDialog
        action={taskAction}
        task={selectedTask}
        working={taskActionWorking}
        error={taskActionError}
        progressLabel={actionProgressLabel}
        mobile={isMobile}
        onClose={() => {
          setTaskAction(null);
          setTaskActionError(null);
          if (!commandState) setActionProgressLabel('');
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
