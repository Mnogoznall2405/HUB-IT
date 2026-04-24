import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  FormGroup,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
  Checkbox,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';
import SettingsApplicationsOutlinedIcon from '@mui/icons-material/SettingsApplicationsOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import GetAppOutlinedIcon from '@mui/icons-material/GetAppOutlined';
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { authAPI, databaseAPI, mailAPI, settingsAPI } from '../api/client';
import OverflowMenu from '../components/common/OverflowMenu';
import { useAuth } from '../contexts/AuthContext';
import { usePreferences } from '../contexts/PreferencesContext';
import { useNotification } from '../contexts/NotificationContext';
import { createNavigateToastAction } from '../components/feedback/toastActions';
import {
  getWindowsNotificationState,
  requestBrowserNotificationPermission,
  setWindowsNotificationsEnabled,
  WINDOWS_NOTIFICATIONS_CHANGED_EVENT,
} from '../lib/windowsNotifications';
import {
  disableChatPushSubscription,
  getChatNotificationState,
  refreshChatNotificationState,
  requestChatNotificationPermission,
  setChatNotificationsEnabled,
  subscribeChatNotificationState,
  syncChatPushSubscription,
} from '../lib/chatNotifications';
import {
  applyPwaUpdate,
  getPwaInstallState,
  promptPwaInstall,
  refreshPwaInstallState,
  subscribePwaInstallState,
} from '../lib/pwaInstall';
import {
  buildOfficeUiTokens,
  getOfficeHeaderBandSx,
  getOfficeMetricBlockSx,
  getOfficePanelSx,
  getOfficeSubtlePanelSx,
} from '../theme/officeUiTokens';

const SETTINGS_TABS = [
  { value: 'profile', label: 'Профиль', icon: <PersonOutlineIcon fontSize="small" /> },
  { value: 'security', label: 'Безопасность', icon: <ShieldOutlinedIcon fontSize="small" /> },
  { value: 'appearance', label: 'Внешний вид', icon: <PaletteOutlinedIcon fontSize="small" /> },
  { value: 'users', label: 'Пользователи', icon: <GroupOutlinedIcon fontSize="small" />, permission: 'settings.users.manage' },
  { value: 'sessions', label: 'Сессии', icon: <SecurityOutlinedIcon fontSize="small" />, permission: 'settings.sessions.manage' },
  { value: 'env', label: 'Переменные', icon: <SettingsApplicationsOutlinedIcon fontSize="small" />, adminOnly: true },
];

const SETTINGS_AI_TAB = {
  value: 'ai-bots',
  label: 'AI Bots',
  icon: <SmartToyOutlinedIcon fontSize="small" />,
  permission: 'settings.ai.manage',
};

const SETTINGS_TABS_WITH_AI = [
  ...SETTINGS_TABS.slice(0, 5),
  SETTINGS_AI_TAB,
  ...SETTINGS_TABS.slice(5),
];

export function resolveAvailableSettingsTabs({ hasPermission, isAdmin }) {
  const safeHasPermission = typeof hasPermission === 'function' ? hasPermission : () => false;
  return SETTINGS_TABS_WITH_AI.filter((item) => {
    if (item.adminOnly) return Boolean(isAdmin);
    if (isAdmin) return true;
    if (!item.permission) return true;
    return safeHasPermission(item.permission);
  });
}

const SETTINGS_VERY_WIDE_QUERY = '(min-width:1920px)';
const ENV_HELP_WIDE_QUERY = '(min-width:1536px)';
const DESKTOP_SCROLL_QUERY = '(min-width:900px)';
const USER_ROWS_PER_PAGE_OPTIONS = [10, 25, 50];
const DEFAULT_USER_ROWS_PER_PAGE = 25;
const CHAT_FOREGROUND_ONLY_REASON_LABELS = {
  server_not_configured: 'Фоновые push недоступны: сервер chat push пока не настроен.',
  yandex_limited: 'Яндекс.Браузер поддерживает chat-уведомления только из открытой вкладки.',
  requires_installed_pwa: 'На iPhone фоновые chat-уведомления работают только из установленной PWA.',
  permission_denied: 'Браузер ещё не дал разрешение на системные уведомления для сайта.',
  not_secure_context: 'Фоновые push требуют HTTPS и безопасный контекст браузера.',
  push_unsupported: 'Этот браузер не поддерживает background web push для chat.',
};
const CHAT_FOREGROUND_DIAGNOSTIC_LABELS = {
  active_visible_conversation: 'Активный чат уже открыт, поэтому отдельное системное уведомление не показывается.',
  notifications_disabled: 'Chat-уведомления сейчас отключены локальным переключателем в этом браузере.',
  permission_not_granted: 'Системные уведомления браузера ещё не разрешены для этого сайта.',
  chat_socket_unavailable: 'Сейчас нет стабильного websocket-соединения для мгновенных chat-событий во вкладке.',
};

const roleOptions = [
  { value: 'admin', label: 'Админ', color: 'error' },
  { value: 'operator', label: 'Оператор', color: 'primary' },
  { value: 'viewer', label: 'Просмотр', color: 'default' },
];

const permissionGroups = [
  {
    group: 'Chat',
    permissions: [
      { value: 'chat.read', label: 'Chat: просмотр' },
      { value: 'chat.write', label: 'Chat: отправка сообщений' },
    ],
  },
  {
    group: 'Общие',
    permissions: [
      { value: 'dashboard.read', label: 'Dashboard: просмотр' },
      { value: 'announcements.write', label: 'Объявления: публикация' },
      { value: 'statistics.read', label: 'Статистика: просмотр' },
    ],
  },
  {
    group: 'IT-invent WEB',
    permissions: [
      { value: 'database.read', label: 'База: просмотр' },
      { value: 'database.write', label: 'База: изменения' },
      { value: 'computers.read', label: 'Компьютеры: просмотр' },
      { value: 'computers.read_all', label: 'Компьютеры: просмотр всех БД' },
    ],
  },
  {
    group: 'Задачи',
    permissions: [
      { value: 'tasks.read', label: 'Задачи: просмотр' },
      { value: 'tasks.write', label: 'Задачи: создание/редактирование' },
      { value: 'tasks.review', label: 'Задачи: проверка' },
    ],
  },
  {
    group: 'Инструменты сети',
    permissions: [
      { value: 'networks.read', label: 'Сети: просмотр' },
      { value: 'networks.write', label: 'Сети: изменения' },
      { value: 'scan.read', label: 'Scan Center: просмотр' },
      { value: 'scan.ack', label: 'Scan Center: ACK инцидентов' },
      { value: 'scan.tasks', label: 'Scan Center: задачи агентам' },
      { value: 'vcs.read', label: 'Терминалы ВКС: просмотр' },
      { value: 'vcs.manage', label: 'Терминалы ВКС: управление' },
    ],
  },
  {
    group: 'Интеграции',
    permissions: [
      { value: 'mail.access', label: 'Почта: доступ к Exchange' },
      { value: 'ad_users.read', label: 'Пользователи AD: просмотр' },
      { value: 'ad_users.manage', label: 'Пользователи AD: управление' },
    ],
  },
  {
    group: 'База знаний',
    permissions: [
      { value: 'kb.read', label: 'База знаний: просмотр' },
      { value: 'kb.write', label: 'База знаний: редактирование' },
      { value: 'kb.publish', label: 'База знаний: публикация' },
    ],
  },
  {
    group: 'Настройки',
    permissions: [
      { value: 'settings.read', label: 'Настройки: просмотр' },
      { value: 'settings.users.manage', label: 'Пользователи: управление' },
      { value: 'settings.sessions.manage', label: 'Сессии: управление' },
    ],
  },
];

const AI_PERMISSION_GROUP = {
  group: 'AI',
  permissions: [
    { value: 'chat.ai.use', label: 'Chat: AI access' },
    { value: 'settings.ai.manage', label: 'Settings: AI bots manage' },
  ],
};

export const SETTINGS_PERMISSION_GROUPS = [
  ...permissionGroups,
  AI_PERMISSION_GROUP,
];

const sessionStatusMeta = {
  active: { label: 'Активна', color: 'success' },
  expired_idle: { label: 'Истекла по idle', color: 'warning' },
  expired_absolute: { label: 'Истекла по времени', color: 'warning' },
  terminated: { label: 'Завершена', color: 'default' },
};

const staticRunbook = {
  pm2: [
    'powershell -ExecutionPolicy Bypass -File C:\\Project\\Image_scan\\scripts\\pm2\\start-all.ps1',
    'powershell -ExecutionPolicy Bypass -File C:\\Project\\Image_scan\\scripts\\pm2\\restart-all.ps1',
    'powershell -ExecutionPolicy Bypass -File C:\\Project\\Image_scan\\scripts\\pm2\\stop-all.ps1',
    'powershell -ExecutionPolicy Bypass -File C:\\Project\\Image_scan\\scripts\\pm2\\health-check.ps1',
  ],
  frontend: [
    'cd C:\\Project\\Image_scan\\WEB-itinvent\\frontend',
    'npm run build',
  ],
};

function normalizePermissions(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeTaskDelegateLinks(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  return list
    .map((item) => ({
      delegate_user_id: String(item?.delegate_user_id || '').trim(),
      role_type: String(item?.role_type || 'assistant').trim() === 'deputy' ? 'deputy' : 'assistant',
      is_active: item?.is_active !== false,
      delegate_username: item?.delegate_username || '',
      delegate_full_name: item?.delegate_full_name || '',
      delegate_department: item?.delegate_department || '',
      delegate_job_title: item?.delegate_job_title || '',
      delegate_is_active: item?.delegate_is_active !== false,
    }))
    .filter((item) => {
      if (!item.delegate_user_id || seen.has(item.delegate_user_id)) return false;
      seen.add(item.delegate_user_id);
      return true;
    });
}

function createEmptyUserDraft() {
  return {
    id: null,
    username: '',
    password: '',
    full_name: '',
    department: '',
    job_title: '',
    email: '',
    mailbox_email: '',
    mailbox_login: '',
    mailbox_password: '',
    telegram_id: '',
    auth_source: 'local',
    assigned_database: '',
    role: 'viewer',
    is_active: true,
    use_custom_permissions: false,
    custom_permissions: [],
    task_delegate_links: [],
  };
}

function createUserDraftFromItem(item) {
  if (!item) return createEmptyUserDraft();
  return {
    id: item.id,
    username: item.username || '',
    password: '',
    full_name: item.full_name || '',
    department: item.department || '',
    job_title: item.job_title || '',
    email: item.email || '',
    mailbox_email: item.mailbox_email || '',
    mailbox_login: item.mailbox_login || '',
    mailbox_password: '',
    telegram_id: item.telegram_id ?? '',
    auth_source: item.auth_source || 'local',
    assigned_database: item.assigned_database || '',
    role: item.role || 'viewer',
    is_active: Boolean(item.is_active),
    use_custom_permissions: Boolean(item.use_custom_permissions),
    custom_permissions: normalizePermissions(item.custom_permissions),
    task_delegate_links: normalizeTaskDelegateLinks(item.task_delegate_links),
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
    mail_updated_at: item.mail_updated_at || null,
  };
}

function buildDefaultExchangeLoginPreview(username) {
  let normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return 'username@zsgp.corp';
  if (normalized.includes('\\')) normalized = normalized.split('\\').pop() || normalized;
  if (normalized.includes('/') && !normalized.includes('@')) normalized = normalized.split('/').pop() || normalized;
  if (normalized.includes('@')) return normalized;
  return `${normalized}@zsgp.corp`;
}

function createEmptyMailboxDraft(user) {
  return {
    id: '',
    label: '',
    mailbox_email: '',
    mailbox_login: buildDefaultExchangeLoginPreview(user?.username),
    mailbox_password: '',
    is_primary: false,
    is_active: true,
  };
}

function createMailboxDraftFromEntry(entry, user) {
  if (!entry) return createEmptyMailboxDraft(user);
  return {
    id: String(entry.id || ''),
    label: String(entry.label || ''),
    mailbox_email: String(entry.mailbox_email || ''),
    mailbox_login: String(entry.mailbox_login || entry.effective_mailbox_login || buildDefaultExchangeLoginPreview(user?.username)),
    mailbox_password: '',
    is_primary: Boolean(entry.is_primary),
    is_active: entry.is_active !== false,
  };
}

function formatDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function summarizePermissions(item) {
  return item?.use_custom_permissions
    ? `${normalizePermissions(item.custom_permissions).length} прав`
    : 'По роли';
}

function getDbName(dbOptions, databaseId) {
  if (!databaseId) return 'Не ограничивать';
  return dbOptions.find((item) => String(item.id) === String(databaseId))?.name || String(databaseId);
}

function matchesUserSearch(item, search) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  return [
    item?.username,
    item?.full_name,
    item?.department,
    item?.job_title,
    item?.email,
    item?.mailbox_email,
    item?.telegram_id,
  ].some((value) => String(value || '').toLowerCase().includes(needle));
}

function useViewportHeight(ref, enabled) {
  const [height, setHeight] = useState(null);

  useEffect(() => {
    if (!enabled || !ref.current) {
      setHeight(null);
      return undefined;
    }

    const update = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const next = Math.max(440, Math.floor(window.innerHeight - rect.top));
      setHeight(next);
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [enabled, ref]);

  return height;
}

function SectionCard({ title, description, action, children, sx, headerSx, contentSx }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  return (
    <Paper
      variant="outlined"
      sx={getOfficePanelSx(ui, {
        borderRadius: '14px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        boxShadow: 'none',
        ...sx,
      })}
    >
      {(title || description || action) ? (
        <>
          <Box
            sx={getOfficeHeaderBandSx(ui, {
              px: 1.35,
              py: 0.95,
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: 'none',
              ...headerSx,
            })}
          >
            <Box sx={{ minWidth: 0 }}>
              {title ? (
                <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.15 }}>
                  {title}
                </Typography>
              ) : null}
              {description ? (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.2, display: 'block', lineHeight: 1.3 }}>
                  {description}
                </Typography>
              ) : null}
            </Box>
            {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
          </Box>
          <Divider sx={{ borderColor: ui.borderSoft }} />
        </>
      ) : null}
      <Box sx={{ p: 1.25, minHeight: 0, flex: 1, ...contentSx }}>{children}</Box>
    </Paper>
  );
}

function MetricTile({ icon, label, value, caption, compact = false }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  return (
    <Paper
      variant="outlined"
      sx={getOfficeMetricBlockSx(ui, theme.palette.primary.main, {
        p: compact ? 0.78 : 1.1,
        borderRadius: '10px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 0.16 : 0.3,
        justifyContent: 'space-between',
        borderColor: ui.borderSoft,
        boxShadow: 'none',
      })}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={0.75}>
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontSize: compact ? '0.64rem' : undefined,
            lineHeight: 1.15,
          }}
        >
          {label}
        </Typography>
        <Box sx={{ color: 'primary.main', display: 'flex', '& .MuiSvgIcon-root': { fontSize: compact ? 16 : 18 } }}>{icon}</Box>
      </Stack>
      <Typography
        variant={compact ? 'subtitle1' : 'h5'}
        sx={{
          fontWeight: 800,
          lineHeight: 1,
          mt: compact ? 0.04 : 0,
        }}
      >
        {value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontSize: compact ? '0.64rem' : undefined,
          lineHeight: 1.1,
        }}
      >
        {caption}
      </Typography>
    </Paper>
  );
}

function ProfileField({ label, value }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ mt: 0.35, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {value || '—'}
      </Typography>
    </Box>
  );
}

function SettingsTabPanel({ active, children }) {
  return (
    <Box
      sx={{
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
        minHeight: 0,
        flex: active ? 1 : 'unset',
        overflow: active ? { xs: 'visible', md: 'hidden' } : 'hidden',
      }}
    >
      {active ? children : null}
    </Box>
  );
}

function ProfileTab({ user, dbOptions }) {
  const { notifyApiError, notifySuccess } = useNotification();
  const [mailboxes, setMailboxes] = useState([]);
  const [mailboxesLoading, setMailboxesLoading] = useState(true);
  const [mailboxDialogOpen, setMailboxDialogOpen] = useState(false);
  const [mailboxDialogMode, setMailboxDialogMode] = useState('create');
  const [mailboxDraft, setMailboxDraft] = useState(() => createEmptyMailboxDraft(user));
  const [mailboxSaving, setMailboxSaving] = useState(false);

  const loadMailboxes = useCallback(async () => {
    setMailboxesLoading(true);
    try {
      const data = await mailAPI.listMailboxes({ includeUnread: true });
      setMailboxes(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить список подключённых ящиков.', {
        source: 'settings-mailboxes',
      });
      setMailboxes([]);
    } finally {
      setMailboxesLoading(false);
    }
  }, [notifyApiError]);

  useEffect(() => {
    loadMailboxes();
  }, [loadMailboxes]);

  useEffect(() => {
    if (!mailboxDialogOpen) {
      setMailboxDraft(createEmptyMailboxDraft(user));
    }
  }, [mailboxDialogOpen, user]);

  const openCreateMailboxDialog = useCallback(() => {
    setMailboxDialogMode('create');
    setMailboxDraft(createEmptyMailboxDraft(user));
    setMailboxDialogOpen(true);
  }, [user]);

  const openEditMailboxDialog = useCallback((entry) => {
    setMailboxDialogMode('edit');
    setMailboxDraft(createMailboxDraftFromEntry(entry, user));
    setMailboxDialogOpen(true);
  }, [user]);

  const handleMailboxDraftChange = useCallback((key, value) => {
    setMailboxDraft((prev) => ({ ...(prev || {}), [key]: value }));
  }, []);

  const handleMailboxSubmit = useCallback(async () => {
    const payload = {
      label: String(mailboxDraft.label || '').trim() || undefined,
      mailbox_email: String(mailboxDraft.mailbox_email || '').trim(),
      mailbox_login: String(mailboxDraft.mailbox_login || '').trim() || undefined,
      mailbox_password: String(mailboxDraft.mailbox_password || ''),
      is_primary: Boolean(mailboxDraft.is_primary),
      is_active: Boolean(mailboxDraft.is_active),
    };
    if (!payload.mailbox_email) return;
    if (mailboxDialogMode === 'create' && !payload.mailbox_password) return;
    setMailboxSaving(true);
    try {
      if (mailboxDialogMode === 'edit' && mailboxDraft.id) {
        await mailAPI.updateMailbox(mailboxDraft.id, payload);
        notifySuccess('Ящик обновлён.', { source: 'settings-mailboxes', dedupeMode: 'none' });
      } else {
        await mailAPI.createMailbox(payload);
        notifySuccess('Ящик подключён.', { source: 'settings-mailboxes', dedupeMode: 'none' });
      }
      setMailboxDialogOpen(false);
      await loadMailboxes();
    } catch (error) {
      notifyApiError(error, mailboxDialogMode === 'edit' ? 'Не удалось обновить ящик.' : 'Не удалось подключить ящик.', {
        source: 'settings-mailboxes',
      });
    } finally {
      setMailboxSaving(false);
    }
  }, [loadMailboxes, mailboxDialogMode, mailboxDraft, notifyApiError, notifySuccess]);

  const handleMailboxPrimary = useCallback(async (entry) => {
    try {
      await mailAPI.updateMailbox(entry.id, { is_primary: true });
      notifySuccess('Основной ящик обновлён.', { source: 'settings-mailboxes', dedupeMode: 'none' });
      await loadMailboxes();
    } catch (error) {
      notifyApiError(error, 'Не удалось назначить основной ящик.', {
        source: 'settings-mailboxes',
      });
    }
  }, [loadMailboxes, notifyApiError, notifySuccess]);

  const handleMailboxActiveToggle = useCallback(async (entry) => {
    try {
      await mailAPI.updateMailbox(entry.id, { is_active: !Boolean(entry?.is_active) });
      notifySuccess(entry?.is_active ? 'Ящик отключён.' : 'Ящик включён.', {
        source: 'settings-mailboxes',
        dedupeMode: 'none',
      });
      await loadMailboxes();
    } catch (error) {
      notifyApiError(error, 'Не удалось изменить состояние ящика.', {
        source: 'settings-mailboxes',
      });
    }
  }, [loadMailboxes, notifyApiError, notifySuccess]);

  const handleMailboxDelete = useCallback(async (entry) => {
    if (!entry?.id) return;
    if (!window.confirm(`Отключить ящик "${entry.label || entry.mailbox_email || 'без названия'}"?`)) return;
    try {
      await mailAPI.deleteMailbox(entry.id);
      notifySuccess('Ящик удалён.', { source: 'settings-mailboxes', dedupeMode: 'none' });
      await loadMailboxes();
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить ящик.', {
        source: 'settings-mailboxes',
      });
    }
  }, [loadMailboxes, notifyApiError, notifySuccess]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0 }}>
      <SectionCard title="Профиль" description="Основные сведения об учётной записи." contentSx={{ p: 1.5 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}><ProfileField label="Логин" value={user?.username} /></Grid>
          <Grid item xs={12} md={6}><ProfileField label="Полное имя" value={user?.full_name} /></Grid>
          <Grid item xs={12} md={6}><ProfileField label="Email" value={user?.email} /></Grid>
          <Grid item xs={12} md={6}><ProfileField label="Должность" value={user?.job_title || 'не указана'} /></Grid>
          <Grid item xs={12} md={6}><ProfileField label="Отдел" value={user?.department || 'не указан'} /></Grid>
          <Grid item xs={12} md={6}><ProfileField label="Telegram ID" value={user?.telegram_id ? String(user.telegram_id) : 'не указан'} /></Grid>
        </Grid>
      </SectionCard>

      <SectionCard title="Интеграции и доступ" description="Источник входа, права и почтовой профиль." contentSx={{ p: 1.5 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><ProfileField label="Роль" value={roleOptions.find((item) => item.value === user?.role)?.label || user?.role} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Источник входа" value={user?.auth_source === 'ldap' ? 'AD / LDAP' : 'Локальная'} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Назначенная БД" value={getDbName(dbOptions, user?.assigned_database)} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Почта Exchange" value={user?.mailbox_email || 'Не настроена'} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Логин Exchange" value={user?.mailbox_login || buildDefaultExchangeLoginPreview(user?.username)} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Права" value={summarizePermissions(user)} /></Grid>
        </Grid>
      </SectionCard>
      <SectionCard
        title="Подключённые ящики"
        description="Основной ящик и локально подключаемые общие ящики для HUB-IT Mail."
        action={(
          <Button size="small" startIcon={<AddOutlinedIcon />} onClick={openCreateMailboxDialog}>
            Добавить
          </Button>
        )}
      >
        <Stack spacing={1}>
          {mailboxesLoading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Загружаю подключённые ящики...</Typography>
            </Stack>
          ) : mailboxes.length === 0 ? (
            <Alert severity="info" sx={{ borderRadius: '10px' }}>
              Дополнительные ящики пока не подключены.
            </Alert>
          ) : mailboxes.map((entry) => (
            <Paper key={String(entry.id)} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
              <Stack spacing={1}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>
                      {entry.label || entry.mailbox_email || 'Без названия'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15, overflowWrap: 'anywhere' }}>
                      {entry.mailbox_email || 'Почта не указана'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                      {entry.mailbox_login || entry.effective_mailbox_login || buildDefaultExchangeLoginPreview(user?.username)}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                    {entry.is_primary ? <Chip size="small" color="primary" label="Основной" /> : null}
                    <Chip size="small" color={entry.is_active ? 'success' : 'default'} label={entry.is_active ? 'Активен' : 'Отключён'} />
                    <Chip size="small" variant="outlined" label={`Unread: ${Number(entry.unread_count || 0)}`} />
                  </Stack>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
                  <Button size="small" variant="outlined" onClick={() => openEditMailboxDialog(entry)}>
                    Редактировать
                  </Button>
                  {!entry.is_primary ? (
                    <Button size="small" variant="outlined" onClick={() => handleMailboxPrimary(entry)}>
                      Сделать основным
                    </Button>
                  ) : null}
                  <Button size="small" variant="outlined" onClick={() => handleMailboxActiveToggle(entry)}>
                    {entry.is_active ? 'Отключить' : 'Включить'}
                  </Button>
                  <Button size="small" color="error" variant="outlined" onClick={() => handleMailboxDelete(entry)}>
                    Удалить
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </SectionCard>
      <HubItPwaSettingsCard />

      <Dialog open={mailboxDialogOpen} onClose={() => setMailboxDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{mailboxDialogMode === 'edit' ? 'Редактировать ящик' : 'Подключить ящик'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25} sx={{ mt: 0.5 }}>
            <TextField
              fullWidth
              size="small"
              label="Название"
              value={mailboxDraft.label}
              onChange={(event) => handleMailboxDraftChange('label', event.target.value)}
            />
            <TextField
              fullWidth
              size="small"
              label="Почта"
              value={mailboxDraft.mailbox_email}
              onChange={(event) => handleMailboxDraftChange('mailbox_email', event.target.value)}
              required
            />
            <TextField
              fullWidth
              size="small"
              label="Логин"
              value={mailboxDraft.mailbox_login}
              onChange={(event) => handleMailboxDraftChange('mailbox_login', event.target.value)}
              placeholder={buildDefaultExchangeLoginPreview(user?.username)}
            />
            <TextField
              fullWidth
              size="small"
              type="password"
              label="Пароль"
              value={mailboxDraft.mailbox_password}
              onChange={(event) => handleMailboxDraftChange('mailbox_password', event.target.value)}
              helperText={mailboxDialogMode === 'edit' ? 'Оставьте пустым, чтобы не менять текущий пароль.' : 'Пароль будет сразу проверен через Exchange.'}
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={Boolean(mailboxDraft.is_primary)}
                  onChange={(event) => handleMailboxDraftChange('is_primary', event.target.checked)}
                />
              )}
              label="Сделать основным"
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={Boolean(mailboxDraft.is_active)}
                  onChange={(event) => handleMailboxDraftChange('is_active', event.target.checked)}
                />
              )}
              label="Ящик активен"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMailboxDialogOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={handleMailboxSubmit}
            disabled={
              mailboxSaving
              || !String(mailboxDraft.mailbox_email || '').trim()
              || (mailboxDialogMode === 'create' && !String(mailboxDraft.mailbox_password || '').trim())
            }
          >
            {mailboxSaving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SecurityTab({
  user,
  trustedDevices,
  loading,
  resettingTwoFactor,
  onReload,
  onRegenerateBackupCodes,
  onRevokeTrustedDevice,
  onResetTwoFactor,
}) {
  const twofaPolicyLabel = user?.twofa_policy === 'external_only'
    ? 'Только для внешней сети'
    : user?.twofa_policy === 'all'
      ? 'Для всех входов'
      : 'Отключен';
  const networkZoneLabel = user?.network_zone === 'internal' ? 'Внутренняя сеть' : 'Внешняя сеть';
  const twofaRequestLabel = user?.twofa_required_for_current_request ? 'Да' : 'Нет';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0 }}>
      <SectionCard
        title="Безопасность входа"
        description="Состояние 2FA, backup-коды и доверенные устройства текущей учётной записи."
        action={(
          <Button size="small" startIcon={<RefreshOutlinedIcon />} onClick={onReload} disabled={loading}>
            Обновить
          </Button>
        )}
        contentSx={{ p: 1.5 }}
      >
        <Grid container spacing={1.25}>
          <Grid item xs={12} md={3}><ProfileField label="2FA" value={user?.is_2fa_enabled ? 'Включен' : 'Не включен'} /></Grid>
          <Grid item xs={12} md={3}><ProfileField label="Политика 2FA" value={twofaPolicyLabel} /></Grid>
          <Grid item xs={12} md={3}><ProfileField label="Текущий вход" value={networkZoneLabel} /></Grid>
          <Grid item xs={12} md={3}><ProfileField label="2FA нужен сейчас" value={twofaRequestLabel} /></Grid>
          <Grid item xs={12} md={3}><ProfileField label="Доверенные устройства" value={String(user?.trusted_devices_count || 0)} /></Grid>
        </Grid>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
          <Button variant="contained" startIcon={<GetAppOutlinedIcon />} onClick={onRegenerateBackupCodes}>
            Сгенерировать новые backup-коды
          </Button>
          <Button
            color="error"
            variant="outlined"
            startIcon={resettingTwoFactor ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineOutlinedIcon />}
            onClick={onResetTwoFactor}
            disabled={loading || resettingTwoFactor}
          >
            Сбросить 2FA и доверенные устройства
          </Button>
        </Stack>
      </SectionCard>

      <SectionCard title="Доверенные устройства" description="Эти устройства могут подтверждать вход через WebAuthn без ручного ввода TOTP-кода.">
        <Stack spacing={1}>
          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Загружаю список устройств...</Typography>
            </Stack>
          ) : trustedDevices.length === 0 ? (
            <Alert severity="info">Доверенные устройства пока не зарегистрированы.</Alert>
          ) : trustedDevices.map((device) => (
            <Paper
              key={device.id}
              variant="outlined"
              sx={{ p: 1.25, borderRadius: 2, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.2, alignItems: { md: 'center' }, justifyContent: 'space-between' }}
            >
              <Stack spacing={0.35}>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                  <Typography sx={{ fontWeight: 700 }}>{device.label || 'Доверенное устройство'}</Typography>
                  {device.is_current_device ? <Chip size="small" color="primary" label="Текущее" /> : null}
                  {!device.is_active ? <Chip size="small" label="Отозвано" /> : null}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Создано: {formatDateTime(device.created_at)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Последнее использование: {formatDateTime(device.last_used_at)}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  color="error"
                  variant="outlined"
                  startIcon={<DeleteOutlineOutlinedIcon />}
                  disabled={!device.is_active}
                  onClick={() => onRevokeTrustedDevice(device.id)}
                >
                  Отозвать
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </SectionCard>
    </Box>
  );
}

function PwaInstallSettingsCard() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { notifyInfo, notifySuccess, notifyWarning } = useNotification();
  const [installState, setInstallState] = useState(() => getPwaInstallState());
  const [chatNotificationState, setChatNotificationState] = useState(() => getChatNotificationState());
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);

  useEffect(() => subscribePwaInstallState(setInstallState), []);
  useEffect(() => subscribeChatNotificationState(setChatNotificationState), []);
  useEffect(() => {
    refreshPwaInstallState();
  }, []);

  const handleInstall = useCallback(async () => {
    if (installState.installed) {
      notifyInfo('Приложение уже установлено. Запускайте HUB-IT с иконки на главном экране.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    if (installState.requiresManualInstall) {
      setShowManualHint(true);
      return;
    }

    if (!installState.secure) {
      notifyWarning('Для установки PWA откройте сайт по HTTPS, а не по обычному HTTP.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    if (!installState.canPrompt) {
      notifyInfo('Браузер пока не выдал системное окно установки. Откройте сайт по HTTPS и попробуйте снова через несколько секунд.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    setInstalling(true);
    try {
      const result = await promptPwaInstall();
      if (result.outcome === 'accepted') {
        notifySuccess('Установка приложения запущена.', { source: 'settings', dedupeMode: 'none' });
      } else if (result.outcome === 'dismissed') {
        notifyInfo('Установка приложения отменена.', { source: 'settings', dedupeMode: 'none' });
      }
    } finally {
      setInstalling(false);
    }
  }, [installState.canPrompt, installState.installed, installState.requiresManualInstall, installState.secure, notifyInfo, notifySuccess, notifyWarning]);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    try {
      const applied = await applyPwaUpdate();
      if (!applied) {
        notifyWarning('Новая версия HUB-IT пока не готова к активации. Повторите попытку через несколько секунд.', {
          source: 'settings',
          dedupeMode: 'recent',
          dedupeKey: 'pwa:update-unavailable',
        });
        return;
      }
      notifyInfo('HUB-IT обновляется. После активации новой версии приложение перезагрузится автоматически.', {
        source: 'settings',
        dedupeMode: 'recent',
        dedupeKey: 'pwa:update-started',
      });
    } finally {
      setUpdating(false);
    }
  }, [notifyInfo, notifyWarning]);

  const actionLabel = installState.installed
    ? 'Уже установлено'
    : installState.requiresManualInstall
      ? 'Как установить'
      : 'Установить приложение';

  const statusLabel = installState.installed
    ? 'Установлено'
    : installState.requiresManualInstall
      ? 'Вручную'
      : installState.canPrompt
        ? 'Готово'
        : installState.secure
          ? 'Ожидание'
          : 'Нужен HTTPS';

  return (
    <SectionCard
      title="Приложение на телефоне"
      description="Установите HUB-IT как отдельное приложение, чтобы открывать чат без обычной браузерной шапки."
      contentSx={{ p: 1.5 }}
      action={<Chip size="small" label={statusLabel} color={installState.installed ? 'success' : 'default'} />}
    >
      <Stack spacing={1.1}>
        {false ? (
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
            borderColor: ui.borderSoft,
          })}
        >
          <Stack direction="row" spacing={1.1} alignItems="flex-start">
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: '12px',
                display: 'grid',
                placeItems: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: theme.palette.primary.main,
                flexShrink: 0,
              }}
            >
              <PhoneIphoneOutlinedIcon fontSize="small" />
            </Box>
            <Stack spacing={0.45} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                HUB-IT как приложение
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                {installState.installed
                  ? 'Приложение уже установлено. Открывайте HUB-IT с ярлыка на главном экране.'
                  : installState.requiresManualInstall
                    ? 'На iPhone установка выполняется вручную через меню "Поделиться" -> "На экран Домой".'
                    : installState.canPrompt
                      ? 'Браузер готов открыть системное окно установки.'
                      : installState.secure
                        ? 'Если кнопка пока недоступна, откройте сайт по HTTPS и попробуйте снова через несколько секунд.'
                        : 'Установка приложения работает только при открытии сайта по HTTPS.'}
              </Typography>
            </Stack>
          </Stack>
        </Paper>
        ) : null}

        {showManualHint && installState.requiresManualInstall ? (
          <Alert severity="info" onClose={() => setShowManualHint(false)}>
            В Safari нажмите <strong>Поделиться</strong>, затем выберите <strong>На экран Домой</strong>. После этого запускайте HUB-IT уже с иконки, а не из вкладки браузера.
          </Alert>
        ) : null}

        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap">
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35, maxWidth: 440 }}>
            PWA-режим появляется только после установки и запуска с ярлыка.
          </Typography>
          <Button
            variant={installState.installed ? 'outlined' : 'contained'}
            startIcon={<GetAppOutlinedIcon />}
            onClick={handleInstall}
            disabled={installing}
          >
            {installing ? 'Подготовка...' : actionLabel}
          </Button>
        </Stack>
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <Stack spacing={0.75}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Push-диагностика
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                color={lastBackgroundConfirmedAt ? 'success' : 'default'}
                label={lastBackgroundConfirmedAt ? 'Фон подтверждён' : 'Фон ещё не подтверждён'}
                variant={lastBackgroundConfirmedAt ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={lastDeliveryMode === 'background' ? 'success' : 'default'}
                label={lastDeliveryMode === 'background' ? 'Последняя доставка: фон' : lastDeliveryMode === 'foreground_or_visible' ? 'Последняя доставка: видимое окно' : 'Режим доставки пока не зафиксирован'}
                variant={lastDeliveryMode ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={pendingResubscribe ? 'warning' : 'default'}
                label={pendingResubscribe ? 'Есть resubscribe-очередь' : 'Resubscribe-очередь пуста'}
                variant={pendingResubscribe ? 'filled' : 'outlined'}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Service worker: {serviceWorkerVersion || 'неизвестно'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последний push получен: {lastPushReceivedAt ? formatDateTime(lastPushReceivedAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее системное уведомление показано: {lastNotificationShownAt ? formatDateTime(lastNotificationShownAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее подтверждение именно фоновой доставки: {lastBackgroundConfirmedAt ? formatDateTime(lastBackgroundConfirmedAt) : '—'}
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </SectionCard>
  );
}

function HubItPwaSettingsCard() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { notifyInfo, notifySuccess, notifyWarning } = useNotification();
  const [installState, setInstallState] = useState(() => getPwaInstallState());
  const [chatNotificationState, setChatNotificationState] = useState(() => getChatNotificationState());
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);

  useEffect(() => subscribePwaInstallState(setInstallState), []);
  useEffect(() => subscribeChatNotificationState(setChatNotificationState), []);
  useEffect(() => {
    refreshPwaInstallState();
  }, []);

  const handleInstall = useCallback(async () => {
    if (installState.installed) {
      notifyInfo('HUB-IT уже установлено. Запускайте приложение с ярлыка на рабочем столе или главном экране.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    if (installState.requiresManualInstall) {
      setShowManualHint(true);
      return;
    }

    if (!installState.secure) {
      notifyWarning('Для установки HUB-IT откройте сайт по HTTPS, а не по обычному HTTP.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    if (!installState.canPrompt) {
      notifyInfo('Браузер пока не подготовил системное окно установки. Оставьте страницу открытой ещё на несколько секунд и повторите попытку.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    setInstalling(true);
    try {
      const result = await promptPwaInstall();
      if (result.outcome === 'accepted') {
        notifySuccess('Установка HUB-IT запущена.', { source: 'settings', dedupeMode: 'none' });
      } else if (result.outcome === 'dismissed') {
        notifyInfo('Установка HUB-IT отменена.', { source: 'settings', dedupeMode: 'none' });
      }
    } finally {
      setInstalling(false);
    }
  }, [installState.canPrompt, installState.installed, installState.requiresManualInstall, installState.secure, notifyInfo, notifySuccess, notifyWarning]);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    try {
      const applied = await applyPwaUpdate();
      if (!applied) {
        notifyWarning('Новая версия HUB-IT пока не готова к активации. Повторите попытку через несколько секунд.', {
          source: 'settings',
          dedupeMode: 'recent',
          dedupeKey: 'pwa:update-unavailable',
        });
        return;
      }
      notifyInfo('HUB-IT обновляется. После активации новой версии приложение перезагрузится автоматически.', {
        source: 'settings',
        dedupeMode: 'recent',
        dedupeKey: 'pwa:update-started',
      });
    } finally {
      setUpdating(false);
    }
  }, [notifyInfo, notifyWarning]);

  const actionLabel = installState.installed
    ? 'Уже установлено'
    : installState.requiresManualInstall
      ? 'Как установить'
      : 'Установить HUB-IT';

  const statusLabel = installState.installed
    ? 'Установлено'
    : installState.requiresManualInstall
      ? 'Ручная установка'
      : installState.canPrompt
        ? 'Готово к установке'
        : installState.secure
          ? 'Ожидание браузера'
          : 'Нужен HTTPS';

  const displayMode = String(installState.displayMode || 'browser').trim() || 'browser';
  const displayModeLabel = {
    browser: 'Во вкладке браузера',
    standalone: 'Установленное приложение',
    'window-controls-overlay': 'Установленное окно HUB-IT',
    'minimal-ui': 'Минимальный режим браузера',
    fullscreen: 'Полноэкранный режим',
  }[displayMode] || displayMode;
  const serviceWorkerVersion = String(installState.serviceWorkerVersion || '').trim();
  const lastRuntimeSyncAt = String(installState.lastRuntimeSyncAt || '').trim();
  const offlineReady = Boolean(installState.offlineReady);
  const updateAvailable = Boolean(installState.updateAvailable);
  const windowControlsOverlaySupported = Boolean(installState.windowControlsOverlaySupported);
  const windowControlsOverlayVisible = Boolean(installState.windowControlsOverlayVisible);
  const lastDeliveryMode = String(chatNotificationState?.lastDeliveryMode || '').trim();
  const lastPushReceivedAt = String(chatNotificationState?.lastPushReceivedAt || '').trim();
  const lastNotificationShownAt = String(chatNotificationState?.lastNotificationShownAt || '').trim();
  const lastBackgroundConfirmedAt = String(chatNotificationState?.lastBackgroundConfirmedAt || '').trim();
  const pendingResubscribe = Boolean(chatNotificationState?.pendingResubscribe);
  const pushSubscribed = Boolean(chatNotificationState?.pushSubscribed);

  return (
    <SectionCard
      title="Приложение HUB-IT"
      description="Установите HUB-IT как приложение, чтобы запускать его быстрее, получать push-уведомления и открывать систему без лишней браузерной оболочки."
      contentSx={{ p: 1.5 }}
      action={<Chip size="small" label={statusLabel} color={installState.installed ? 'success' : 'default'} />}
    >
      <Stack spacing={1.1}>
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
            borderColor: ui.borderSoft,
          })}
        >
          <Stack direction="row" spacing={1.1} alignItems="flex-start">
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: '12px',
                display: 'grid',
                placeItems: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: theme.palette.primary.main,
                flexShrink: 0,
              }}
            >
              <PhoneIphoneOutlinedIcon fontSize="small" />
            </Box>
            <Stack spacing={0.45} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                HUB-IT как нативное приложение
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                {installState.installed
                  ? 'Приложение уже установлено. Запускайте HUB-IT с ярлыка, чтобы работать в standalone-режиме с app shell, push и badge.'
                  : installState.requiresManualInstall
                    ? 'На iPhone установка выполняется вручную через меню «Поделиться» и пункт «На экран Домой».'
                    : installState.canPrompt
                      ? 'Браузер готов открыть системное окно установки HUB-IT.'
                      : installState.secure
                        ? 'Если кнопка пока недоступна, дайте странице несколько секунд: браузеру нужно подготовить install prompt и service worker.'
                        : 'Установка приложения работает только при открытии HUB-IT по HTTPS.'}
              </Typography>
            </Stack>
          </Stack>
        </Paper>

        {showManualHint && installState.requiresManualInstall ? (
          <Alert severity="info" onClose={() => setShowManualHint(false)}>
            В Safari нажмите <strong>Поделиться</strong>, затем выберите <strong>На экран Домой</strong>. После этого запускайте HUB-IT с иконки, а не из вкладки браузера.
          </Alert>
        ) : null}

        <Stack
          direction={isMobile ? 'column' : 'row'}
          spacing={1}
          alignItems={isMobile ? 'stretch' : 'center'}
          justifyContent="space-between"
          flexWrap="wrap"
        >
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35, maxWidth: 500 }}>
            После установки HUB-IT запускается как отдельное приложение, держит offline-shell, обновляется через service worker и лучше ведёт себя для push на телефоне и desktop.
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button
              variant={installState.installed ? 'outlined' : 'contained'}
              startIcon={<GetAppOutlinedIcon />}
              onClick={handleInstall}
              disabled={installing}
            >
              {installing ? 'Подготовка...' : actionLabel}
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshOutlinedIcon />}
              onClick={() => {
                if (!updateAvailable) {
                  notifyInfo('Сейчас новая версия HUB-IT не ожидает активации. Когда service worker скачает обновление, кнопка начнёт применять его сразу.', {
                    source: 'settings',
                    dedupeMode: 'recent',
                    dedupeKey: 'pwa:update-idle',
                  });
                  return;
                }
                void handleUpdate();
              }}
              disabled={updating}
            >
              {updating ? 'Обновляем...' : 'Обновить HUB-IT'}
            </Button>
          </Stack>
        </Stack>

        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <Stack spacing={0.75}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Диагностика HUB-IT
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                color={offlineReady ? 'success' : 'default'}
                label={offlineReady ? 'Offline shell готов' : 'Offline shell ещё не готов'}
                variant={offlineReady ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={pushSubscribed ? 'success' : 'default'}
                label={pushSubscribed ? 'Push-подписка активна' : 'Push-подписка не активна'}
                variant={pushSubscribed ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={updateAvailable ? 'warning' : 'default'}
                label={updateAvailable ? 'Доступно обновление' : 'Версия актуальна'}
                variant={updateAvailable ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={lastBackgroundConfirmedAt ? 'success' : 'default'}
                label={lastBackgroundConfirmedAt ? 'Фоновый push подтверждён' : 'Фоновый push ещё не подтверждён'}
                variant={lastBackgroundConfirmedAt ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={pendingResubscribe ? 'warning' : 'default'}
                label={pendingResubscribe ? 'Есть очередь resubscribe' : 'Очередь resubscribe пуста'}
                variant={pendingResubscribe ? 'filled' : 'outlined'}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Режим запуска: {displayModeLabel}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Service worker: {serviceWorkerVersion || 'ещё не синхронизирован'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последняя синхронизация runtime: {lastRuntimeSyncAt ? formatDateTime(lastRuntimeSyncAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Window controls overlay: {windowControlsOverlaySupported ? (windowControlsOverlayVisible ? 'активен' : 'поддерживается, но сейчас скрыт') : 'не поддерживается'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последний принятый push: {lastPushReceivedAt ? formatDateTime(lastPushReceivedAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее системное уведомление: {lastNotificationShownAt ? formatDateTime(lastNotificationShownAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее подтверждение фоновой доставки: {lastBackgroundConfirmedAt ? formatDateTime(lastBackgroundConfirmedAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последний режим доставки: {lastDeliveryMode === 'background' ? 'фон' : lastDeliveryMode === 'foreground_or_visible' ? 'видимое окно' : 'ещё не определён'}
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </SectionCard>
  );
}

function AppearanceTab({
  themeMode,
  setThemeMode,
  fontFamily,
  setFontFamily,
  fontScale,
  setFontScale,
  handleSavePreferences,
  saving,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);

  return (
    <Grid container spacing={1.25} sx={{ minHeight: 0 }}>
      <Grid item xs={12} lg={7}>
        <SectionCard
          title="Внешний вид"
          description="Тема, шрифт и масштаб применяются после сохранения."
          contentSx={{ p: 1.5 }}
        >
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Тема</InputLabel>
                <Select value={themeMode} label="Тема" onChange={(event) => setThemeMode(event.target.value)}>
                  <MenuItem value="light">Светлая</MenuItem>
                  <MenuItem value="dark">Тёмная</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Шрифт</InputLabel>
                <Select value={fontFamily} label="Шрифт" onChange={(event) => setFontFamily(event.target.value)}>
                  <MenuItem value="Inter">Inter</MenuItem>
                  <MenuItem value="Roboto">Roboto</MenuItem>
                  <MenuItem value="Segoe UI">Segoe UI</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
                Масштаб шрифта: {fontScale.toFixed(2)}
              </Typography>
              <Slider min={0.9} max={1.2} step={0.05} value={fontScale} onChange={(_, value) => setFontScale(Array.isArray(value) ? value[0] : value)} />
            </Grid>
          </Grid>
          <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
              Сохранение сразу обновляет интерфейс.
            </Typography>
            <Button variant="contained" startIcon={<SaveOutlinedIcon />} onClick={handleSavePreferences} disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </Box>
        </SectionCard>
      </Grid>
      <Grid item xs={12} lg={5}>
        <SectionCard title="Предпросмотр" description="Компактное превью текущей темы." contentSx={{ p: 1.5 }}>
          <Box
            sx={getOfficeSubtlePanelSx(ui, {
              p: 1.5,
              borderRadius: '12px',
              bgcolor: ui.panelInset,
            })}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Служебная панель
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.4, mb: 1.1, display: 'block', lineHeight: 1.35 }}>
              Пример формы и карточки в админском стиле.
            </Typography>
            <Paper
              variant="outlined"
              sx={{
                p: 1.1,
                borderRadius: '12px',
                mb: 1.1,
                bgcolor: ui.panelSolid,
                borderColor: ui.borderSoft,
                boxShadow: 'none',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700 }}>Карточка</Typography>
              <Typography variant="caption" color="text.secondary">Прямоугольные панели и умеренный контраст.</Typography>
            </Paper>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="contained">Основное действие</Button>
              <Button size="small" variant="outlined">Вторичное</Button>
            </Stack>
          </Box>
        </SectionCard>
      </Grid>
      <Grid item xs={12}>
        <NotificationChannelsSettingsCard />
      </Grid>
      <Grid item xs={12}>
        <ChatNotificationsSettingsCard />
      </Grid>
      <Grid item xs={12}>
        <BrowserNotificationsSettingsCard />
      </Grid>
    </Grid>
  );
}

export function NotificationChannelsSettingsCard() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channels, setChannels] = useState({
    mail: true,
    tasks: true,
    announcements: true,
    chat: true,
  });

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsAPI.getNotificationPreferences();
      setChannels({
        mail: Boolean(data?.channels?.mail ?? true),
        tasks: Boolean(data?.channels?.tasks ?? true),
        announcements: Boolean(data?.channels?.announcements ?? true),
        chat: Boolean(data?.channels?.chat ?? true),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const handleToggle = useCallback(async (key, value) => {
    setChannels((prev) => ({ ...prev, [key]: Boolean(value) }));
    setSaving(true);
    try {
      const data = await settingsAPI.updateNotificationPreferences({ [key]: Boolean(value) });
      setChannels({
        mail: Boolean(data?.channels?.mail ?? true),
        tasks: Boolean(data?.channels?.tasks ?? true),
        announcements: Boolean(data?.channels?.announcements ?? true),
        chat: Boolean(data?.channels?.chat ?? true),
      });
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <SectionCard
      title="Каналы уведомлений"
      description="Один push/browser-permission для сайта и отдельные переключатели каналов: почта, задачи, объявления, chat."
      contentSx={{ p: 1.5 }}
    >
      <Stack spacing={1.1}>
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <FormGroup>
            {[
              ['mail', 'Почта'],
              ['tasks', 'Задачи'],
              ['announcements', 'Объявления'],
              ['chat', 'Chat'],
            ].map(([key, label]) => (
              <FormControlLabel
                key={key}
                control={(
                  <Switch
                    checked={Boolean(channels[key])}
                    onChange={(event) => handleToggle(key, event?.target?.checked)}
                    disabled={loading || saving}
                  />
                )}
                label={label}
              />
            ))}
          </FormGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.45 }}>
            Если разрешение браузера уже выдано, desktop/pwa push будет приходить только по включённым каналам.
          </Typography>
        </Paper>
      </Stack>
    </SectionCard>
  );
}

export function ChatNotificationsSettingsCard() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { user } = useAuth();
  const { notifyInfo, notifySuccess, notifyWarning } = useNotification();
  const [chatNotificationState, setChatNotificationState] = useState(() => getChatNotificationState());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeChatNotificationState(setChatNotificationState), []);
  useEffect(() => {
    refreshChatNotificationState();
  }, []);

  const handleSyncSubscription = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const snapshot = await syncChatPushSubscription({ user, force: true });
      if (snapshot.pushSubscribed) {
        notifySuccess('Chat-уведомления подключены для этого браузера.', { source: 'settings', dedupeMode: 'none' });
      } else if (snapshot.yandexLimited && snapshot.foregroundCapable) {
        notifyInfo('В Яндекс.Браузере chat-уведомления работают только из открытой вкладки. Фоновый push для него не включается.', {
          source: 'settings',
          dedupeMode: 'none',
        });
      } else if (snapshot.foregroundOnlyReason === 'server_not_configured') {
        notifyWarning('Сервер chat push пока не настроен. Во вкладке уведомления могут работать, но фоновая доставка сейчас недоступна.', {
          source: 'settings',
          dedupeMode: 'none',
        });
      } else if (snapshot.foregroundCapable) {
        notifyInfo('Разрешение выдано, но фоновые push-уведомления пока недоступны. Вкладочные уведомления продолжат работать.', {
          source: 'settings',
          dedupeMode: 'none',
        });
      }
    } catch (error) {
      console.error('Chat notification subscription sync failed:', error);
      notifyWarning('Не удалось обновить push-подписку для chat. Проверьте HTTPS и разрешение браузера.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      refreshChatNotificationState();
    } finally {
      setBusy(false);
    }
  }, [notifyInfo, notifySuccess, notifyWarning, user]);

  const handleToggleEnabled = useCallback(async (event) => {
    const enabled = setChatNotificationsEnabled(Boolean(event?.target?.checked));
    if (!enabled) {
      setBusy(true);
      try {
        await disableChatPushSubscription({ removeServer: Boolean(user) });
      } finally {
        setBusy(false);
      }
      return;
    }
    refreshChatNotificationState();
    if (chatNotificationState.permission === 'granted' && user) {
      await handleSyncSubscription();
    }
  }, [chatNotificationState.permission, handleSyncSubscription, user]);

  const handleRequestPermission = useCallback(async () => {
    setBusy(true);
    try {
      const permission = await requestChatNotificationPermission();
      if (permission === 'granted' && user) {
        await handleSyncSubscription();
      } else {
        refreshChatNotificationState();
      }
    } finally {
      setBusy(false);
    }
  }, [handleSyncSubscription, user]);

  const permission = String(chatNotificationState?.permission || 'unsupported');
  const enabled = Boolean(chatNotificationState?.enabled);
  const foregroundOnlyReason = String(chatNotificationState?.foregroundOnlyReason || '').trim();
  const foregroundDiagnostic = String(chatNotificationState?.foregroundDiagnostic || '').trim();
  const lastDeliveryMode = String(chatNotificationState?.lastDeliveryMode || '').trim();
  const lastPushReceivedAt = String(chatNotificationState?.lastPushReceivedAt || '').trim();
  const lastNotificationShownAt = String(chatNotificationState?.lastNotificationShownAt || '').trim();
  const lastBackgroundConfirmedAt = String(chatNotificationState?.lastBackgroundConfirmedAt || '').trim();
  const serviceWorkerVersion = String(chatNotificationState?.serviceWorkerVersion || '').trim();
  const pendingResubscribe = Boolean(chatNotificationState?.pendingResubscribe);
  const statusLabel = chatNotificationState.pushSubscribed
    ? 'Push подключен'
    : chatNotificationState.yandexLimited && chatNotificationState.foregroundCapable
      ? 'Только во вкладке'
      : chatNotificationState.foregroundCapable
        ? 'Только во вкладке'
        : foregroundOnlyReason === 'server_not_configured'
          ? 'Сервер push не настроен'
          : enabled
            ? 'Ожидание'
            : 'Выключено';

  return (
    <SectionCard
      title="Chat-уведомления"
      description="Новые сообщения чата: системные уведомления во вкладке и web-push в фоне, если браузер поддерживает этот режим."
      action={(
        <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" justifyContent="flex-end">
          <Chip
            size="small"
            icon={<NotificationsActiveOutlinedIcon sx={{ fontSize: '14px !important' }} />}
            label={statusLabel}
            color={chatNotificationState.pushSubscribed ? 'success' : enabled ? 'primary' : 'default'}
            variant={chatNotificationState.pushSubscribed || enabled ? 'filled' : 'outlined'}
          />
        </Stack>
      )}
      contentSx={{ p: 1.5 }}
    >
      <Stack spacing={1.2}>
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <FormControlLabel
            control={(
              <Switch
                checked={enabled}
                onChange={handleToggleEnabled}
                disabled={!chatNotificationState.supported || busy}
              />
            )}
            label={enabled ? 'Разрешать chat-уведомления в этом браузере' : 'Chat-уведомления отключены'}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.45 }}>
            На desktop Chromium и Android Chromium возможна фоновая web-push доставка. На iPhone нужен запуск из установленной PWA.
          </Typography>
        </Paper>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button
            variant={permission === 'granted' ? 'outlined' : 'contained'}
            onClick={handleRequestPermission}
            disabled={!chatNotificationState.supported || busy || permission === 'granted'}
            startIcon={busy ? <CircularProgress color="inherit" size={14} /> : <NotificationsActiveOutlinedIcon fontSize="small" />}
          >
            {busy && permission !== 'granted' ? 'Запрос...' : permission === 'granted' ? 'Разрешение выдано' : 'Разрешить уведомления'}
          </Button>
          <Button
            variant="outlined"
            onClick={handleSyncSubscription}
            disabled={!enabled || permission !== 'granted' || busy || !user}
          >
            {busy && permission === 'granted'
              ? 'Обновление...'
              : chatNotificationState.yandexLimited
                ? 'Проверить состояние'
                : 'Обновить подписку'}
          </Button>
        </Stack>

        {!chatNotificationState.supported ? (
          <Alert severity="warning">
            В этом браузере системные chat-уведомления не поддерживаются. Внутренние unread-индикаторы продолжат работать.
          </Alert>
        ) : null}

        {permission === 'default' ? (
          <Alert severity="info">
            Браузер ещё не получил разрешение на chat-уведомления. Разрешение общее для сайта и используется и на Windows, и на мобильных устройствах.
          </Alert>
        ) : null}

        {permission === 'denied' ? (
          <Alert severity="warning">
            Браузер сейчас блокирует chat-уведомления для этого сайта. Разрешите уведомления в настройках браузера и затем обновите подписку.
          </Alert>
        ) : null}

        {chatNotificationState.requiresInstalledPwa ? (
          <Alert severity="info">
            На iPhone фоновые chat-уведомления работают только из установленной PWA. Установите HUB-IT на экран Домой и запускайте с иконки.
          </Alert>
        ) : null}

        {chatNotificationState.yandexLimited ? (
          <Alert severity="warning">
            В Яндекс.Браузере chat-уведомления поддерживаются только из открытой вкладки. Для гарантированного background push используйте Chrome, Edge или установленную iOS PWA.
          </Alert>
        ) : null}

        {enabled && permission === 'granted' && chatNotificationState.pushSubscribed ? (
          <Alert severity="success">
            Фоновая push-подписка активна. Новые сообщения чата будут приходить и вне открытой вкладки на поддерживаемых устройствах.
          </Alert>
        ) : null}

        {enabled && permission === 'granted' && !chatNotificationState.pushSubscribed ? (
          <Alert severity={chatNotificationState.pushConfigured ? 'info' : 'warning'}>
            {CHAT_FOREGROUND_ONLY_REASON_LABELS[foregroundOnlyReason]
              || (
                chatNotificationState.pushConfigured
                  ? 'Разрешение уже выдано. Если push всё ещё не подключён, обновите подписку или откройте приложение в поддерживаемом браузере.'
                  : 'Фоновый chat push пока недоступен на сервере или в этом браузере. Пока будут работать только уведомления в открытом приложении.'
              )}
          </Alert>
        ) : null}

        {enabled && permission === 'granted' && foregroundDiagnostic ? (
          <Alert severity={foregroundDiagnostic === 'chat_socket_unavailable' ? 'warning' : 'info'}>
            {CHAT_FOREGROUND_DIAGNOSTIC_LABELS[foregroundDiagnostic] || 'Состояние chat-уведомлений обновлено.'}
          </Alert>
        ) : null}

        {chatNotificationState.lastError ? (
          <Alert severity="warning">
            Последняя попытка синхронизации push-подписки завершилась ошибкой. Повторите обновление подписки после проверки HTTPS и разрешения браузера.
          </Alert>
        ) : null}

        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <Stack spacing={0.75}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Push-диагностика
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                color={lastBackgroundConfirmedAt ? 'success' : 'default'}
                label={lastBackgroundConfirmedAt ? 'Фон подтверждён' : 'Фон ещё не подтверждён'}
                variant={lastBackgroundConfirmedAt ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={lastDeliveryMode === 'background' ? 'success' : 'default'}
                label={lastDeliveryMode === 'background' ? 'Последняя доставка: фон' : lastDeliveryMode === 'foreground_or_visible' ? 'Последняя доставка: видимое окно' : 'Режим доставки не зафиксирован'}
                variant={lastDeliveryMode ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={pendingResubscribe ? 'warning' : 'default'}
                label={pendingResubscribe ? 'Есть resubscribe-очередь' : 'Resubscribe-очередь пуста'}
                variant={pendingResubscribe ? 'filled' : 'outlined'}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Service worker: {serviceWorkerVersion || 'неизвестно'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последний push получен: {lastPushReceivedAt ? formatDateTime(lastPushReceivedAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее системное уведомление показано: {lastNotificationShownAt ? formatDateTime(lastNotificationShownAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее подтверждение именно фоновой доставки: {lastBackgroundConfirmedAt ? formatDateTime(lastBackgroundConfirmedAt) : '—'}
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </SectionCard>
  );
}

export function BrowserNotificationsSettingsCard() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [notificationState, setNotificationState] = useState(() => getWindowsNotificationState());
  const [requestingPermission, setRequestingPermission] = useState(false);

  const syncNotificationState = useCallback(() => {
    setNotificationState(getWindowsNotificationState());
  }, []);

  useEffect(() => {
    syncNotificationState();
    window.addEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, syncNotificationState);
    window.addEventListener('focus', syncNotificationState);
    document.addEventListener('visibilitychange', syncNotificationState);
    return () => {
      window.removeEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, syncNotificationState);
      window.removeEventListener('focus', syncNotificationState);
      document.removeEventListener('visibilitychange', syncNotificationState);
    };
  }, [syncNotificationState]);

  const handleToggleEnabled = useCallback((event) => {
    setWindowsNotificationsEnabled(Boolean(event?.target?.checked));
    syncNotificationState();
  }, [syncNotificationState]);

  const handleRequestPermission = useCallback(async () => {
    setRequestingPermission(true);
    try {
      const permission = await requestBrowserNotificationPermission();
      if (permission === 'granted') {
        setWindowsNotificationsEnabled(true);
      } else if (permission === 'denied') {
        setWindowsNotificationsEnabled(false);
      }
      syncNotificationState();
    } finally {
      setRequestingPermission(false);
    }
  }, [syncNotificationState]);

  const permission = String(notificationState?.permission || 'unsupported');
  const supported = Boolean(notificationState?.supported);
  const enabled = Boolean(notificationState?.enabled);

  const permissionChip = supported
    ? (
      permission === 'granted'
        ? { label: 'Разрешено', color: 'success' }
        : permission === 'denied'
          ? { label: 'Запрещено', color: 'warning' }
          : { label: 'Не запрошено', color: 'default' }
    )
    : { label: 'Не поддерживается', color: 'default' };

  return (
    <SectionCard
      title="Windows-уведомления"
      description="Системные уведомления браузера для hub-событий. Настройка хранится локально в текущем браузере на этой машине."
      action={(
        <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" justifyContent="flex-end">
          <Chip
            size="small"
            icon={<NotificationsActiveOutlinedIcon sx={{ fontSize: '14px !important' }} />}
            label={enabled ? 'Включены' : 'Выключены'}
            color={enabled ? 'primary' : 'default'}
            variant={enabled ? 'filled' : 'outlined'}
          />
          <Chip size="small" label={permissionChip.label} color={permissionChip.color} variant="outlined" />
        </Stack>
      )}
      contentSx={{ p: 1.5 }}
    >
      <Stack spacing={1.2}>
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <FormControlLabel
            control={(
              <Switch
                checked={enabled}
                onChange={handleToggleEnabled}
                disabled={!supported}
              />
            )}
            label={enabled ? 'Показывать Windows-уведомления для hub-событий' : 'Windows-уведомления отключены'}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.45 }}>
            Используется Browser Notification API. Уведомления работают, пока сайт открыт в браузере и для сайта выдано разрешение.
          </Typography>
        </Paper>

        {!supported ? (
          <Alert severity="warning">
            В этом браузере системные уведомления не поддерживаются. Внутренние web-toast уведомления продолжат работать как раньше.
          </Alert>
        ) : null}

        {supported && permission === 'default' ? (
          <Alert
            severity="info"
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={handleRequestPermission}
                disabled={requestingPermission}
              >
                {requestingPermission ? 'Запрос...' : 'Разрешить уведомления'}
              </Button>
            )}
          >
            Браузер ещё не получил разрешение на системные уведомления. Включите разрешение, чтобы новые hub-события приходили в Windows Notification Center.
          </Alert>
        ) : null}

        {supported && permission === 'denied' ? (
          <Alert severity="warning">
            Браузер сейчас блокирует системные уведомления для этого сайта. Разрешите уведомления в настройках браузера, после чего вернитесь на эту страницу.
          </Alert>
        ) : null}

        {supported && permission === 'granted' ? (
          <Alert severity={enabled ? 'success' : 'info'}>
            {enabled
              ? 'Системные уведомления разрешены и будут дублировать новые hub-события в Windows.'
              : 'Разрешение уже выдано, но локальный переключатель сейчас выключен.'}
          </Alert>
        ) : null}
      </Stack>
    </SectionCard>
  );
}

function UserDraftFields({ draft, onChange, dbOptions, linkedSessions, users }) {
  const togglePermission = useCallback((permission) => {
    const current = normalizePermissions(draft.custom_permissions);
    if (current.includes(permission)) {
      onChange('custom_permissions', current.filter((item) => item !== permission));
      return;
    }
    onChange('custom_permissions', [...current, permission]);
  }, [draft.custom_permissions, onChange]);

  const delegateOptions = useMemo(
    () => (Array.isArray(users) ? users : []).filter((item) => Number(item.id) !== Number(draft.id) && item.is_active),
    [draft.id, users],
  );

  const delegateLinks = normalizeTaskDelegateLinks(draft.task_delegate_links);

  const updateDelegateLinks = useCallback((nextValue) => {
    onChange('task_delegate_links', normalizeTaskDelegateLinks(nextValue));
  }, [onChange]);

  const addDelegateLink = useCallback(() => {
    const firstAvailable = delegateOptions.find((item) => !delegateLinks.some((link) => Number(link.delegate_user_id) === Number(item.id)));
    if (!firstAvailable) return;
    updateDelegateLinks([
      ...delegateLinks,
      {
        delegate_user_id: String(firstAvailable.id),
        role_type: 'assistant',
        is_active: true,
        delegate_username: firstAvailable.username || '',
        delegate_full_name: firstAvailable.full_name || '',
      },
    ]);
  }, [delegateLinks, delegateOptions, updateDelegateLinks]);

  return (
    <Stack spacing={2}>
      <SectionCard title="Профиль" description="Базовые данные пользователя и история изменений.">
        <Grid container spacing={1.5}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Логин"
              value={draft.username}
              onChange={(event) => onChange('username', event.target.value)}
              disabled={Boolean(draft.id)}
            />
          </Grid>
          {!draft.id && draft.auth_source !== 'ldap' ? (
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                type="password"
                label="Пароль"
                helperText="Для локального пользователя нужен пароль не короче 6 символов."
                value={draft.password}
                onChange={(event) => onChange('password', event.target.value)}
              />
            </Grid>
          ) : null}
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="ФИО" value={draft.full_name} onChange={(event) => onChange('full_name', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Email" value={draft.email} onChange={(event) => onChange('email', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Должность" value={draft.job_title} onChange={(event) => onChange('job_title', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Отдел" value={draft.department} onChange={(event) => onChange('department', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Telegram ID" value={draft.telegram_id} onChange={(event) => onChange('telegram_id', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
              <Typography variant="caption" color="text.secondary">Создан / обновлён</Typography>
              <Typography variant="body2" sx={{ mt: 0.4 }}>{formatDateTime(draft.created_at)}</Typography>
              <Typography variant="body2" sx={{ mt: 0.35 }}>{formatDateTime(draft.updated_at)}</Typography>
            </Paper>
          </Grid>
        </Grid>
      </SectionCard>

      <SectionCard title="Доступ" description="Источник входа, роль, ограничения базы и права доступа.">
        <Grid container spacing={1.5}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Источник</InputLabel>
              <Select label="Источник" value={draft.auth_source} onChange={(event) => onChange('auth_source', event.target.value)}>
                <MenuItem value="local">Локальная</MenuItem>
                <MenuItem value="ldap">AD / LDAP</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Роль</InputLabel>
              <Select label="Роль" value={draft.role} onChange={(event) => onChange('role', event.target.value)}>
                {roleOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Назначенная БД</InputLabel>
              <Select label="Назначенная БД" value={draft.assigned_database || ''} onChange={(event) => onChange('assigned_database', event.target.value)}>
                <MenuItem value="">Не ограничивать</MenuItem>
                {dbOptions.map((db) => (
                  <MenuItem key={db.id} value={db.id}>{db.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControlLabel control={<Switch checked={Boolean(draft.is_active)} onChange={(event) => onChange('is_active', event.target.checked)} />} label="Учётная запись активна" />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControlLabel control={<Switch checked={Boolean(draft.use_custom_permissions)} onChange={(event) => onChange('use_custom_permissions', event.target.checked)} />} label="Индивидуальные права" />
          </Grid>
        </Grid>

        {Boolean(draft.use_custom_permissions) ? (
          <Box sx={{ mt: 1.5 }}>
            {SETTINGS_PERMISSION_GROUPS.map((group) => (
              <Accordion key={group.group} disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{group.group}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <FormGroup>
                    {group.permissions.map((permission) => {
                      const checked = normalizePermissions(draft.custom_permissions).includes(permission.value);
                      return (
                        <FormControlLabel
                          key={permission.value}
                          control={<Checkbox size="small" checked={checked} onChange={() => togglePermission(permission.value)} />}
                          label={permission.label}
                        />
                      );
                    })}
                  </FormGroup>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        ) : null}
      </SectionCard>

      <SectionCard title="Почта" description="Параметры Exchange и источник почтового профиля.">
        <Grid container spacing={1.5}>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="Почта Exchange" value={draft.mailbox_email} onChange={(event) => onChange('mailbox_email', event.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              size="small"
              label="Логин Exchange"
              placeholder={buildDefaultExchangeLoginPreview(draft.username)}
              value={draft.mailbox_login}
              onChange={(event) => onChange('mailbox_login', event.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <Alert severity="info" sx={{ borderRadius: '10px' }}>
              Пароль корпоративной почты больше не хранится и не меняется в настройках. Пользователь вводит его только на странице <strong>Почта</strong> при первом входе или после смены пароля в AD.
            </Alert>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" color="text.secondary">
              Почта обновлена: {formatDateTime(draft.mail_updated_at)}
            </Typography>
          </Grid>
        </Grid>
      </SectionCard>

      <SectionCard title="Помощники и замы" description="Получают уведомления по задачам и доступ на чтение карточек исполнителя.">
        {!draft.id ? (
          <Typography variant="body2" color="text.secondary">
            Сначала создайте пользователя, затем назначьте помощников и замов.
          </Typography>
        ) : (
          <Stack spacing={1.1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Активные связи используются для уведомлений и доступа к чужим задачам на чтение.
              </Typography>
              <Button variant="outlined" size="small" onClick={addDelegateLink} disabled={delegateOptions.length === 0} sx={{ alignSelf: 'flex-start' }}>
                Добавить связь
              </Button>
            </Stack>

            {delegateLinks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Помощники и замы не назначены.
              </Typography>
            ) : delegateLinks.map((item, index) => (
              <Paper key={`${item.delegate_user_id}-${index}`} variant="outlined" sx={{ p: 1.1, borderRadius: 2 }}>
                <Grid container spacing={1.1} alignItems="center">
                  <Grid item xs={12} md={5}>
                    <FormControl fullWidth size="small">
                      <InputLabel id={`delegate-user-${index}`}>Пользователь</InputLabel>
                      <Select
                        labelId={`delegate-user-${index}`}
                        label="Пользователь"
                        value={String(item.delegate_user_id || '')}
                        onChange={(event) => {
                          const nextValue = String(event.target.value || '');
                          const nextUser = delegateOptions.find((userItem) => String(userItem.id) === nextValue);
                          updateDelegateLinks(delegateLinks.map((row, rowIndex) => (
                            rowIndex === index
                              ? {
                                  ...row,
                                  delegate_user_id: nextValue,
                                  delegate_username: nextUser?.username || '',
                                  delegate_full_name: nextUser?.full_name || '',
                                }
                              : row
                          )));
                        }}
                      >
                        {delegateOptions.map((userItem) => (
                          <MenuItem key={userItem.id} value={String(userItem.id)}>
                            {userItem.full_name || userItem.username}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <FormControl fullWidth size="small">
                      <InputLabel id={`delegate-role-${index}`}>Роль</InputLabel>
                      <Select
                        labelId={`delegate-role-${index}`}
                        label="Роль"
                        value={item.role_type}
                        onChange={(event) => {
                          updateDelegateLinks(delegateLinks.map((row, rowIndex) => (
                            rowIndex === index ? { ...row, role_type: event.target.value } : row
                          )));
                        }}
                      >
                        <MenuItem value="assistant">Помощник</MenuItem>
                        <MenuItem value="deputy">Зам</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={item.is_active !== false}
                          onChange={(event) => {
                            updateDelegateLinks(delegateLinks.map((row, rowIndex) => (
                              rowIndex === index ? { ...row, is_active: event.target.checked } : row
                            )));
                          }}
                        />
                      )}
                      label="Активна"
                    />
                  </Grid>
                  <Grid item xs={12} md={2} sx={{ display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                    <Button
                      color="error"
                      variant="text"
                      onClick={() => updateDelegateLinks(delegateLinks.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      Удалить
                    </Button>
                  </Grid>
                </Grid>
              </Paper>
            ))}
          </Stack>
        )}
      </SectionCard>

      <SectionCard title="Статус и сессии" description="Связанные активные сессии пользователя.">
        {linkedSessions.length > 0 ? (
          <Stack spacing={1}>
            {linkedSessions.map((session) => (
              <Paper key={session.session_id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                      {session.device_label || 'Устройство'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {session.ip_address || 'IP неизвестен'} • {formatDateTime(session.last_seen_at)}
                    </Typography>
                  </Box>
                  <Chip size="small" color="success" label="Активна" />
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">Активных сессий нет.</Typography>
        )}
      </SectionCard>
    </Stack>
  );
}

function UsersTab({
  currentUserId,
  users,
  sessions,
  dbOptions,
  loading,
  syncingAD,
  savingUser,
  onSyncAD,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  isVeryWide,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [dbFilter, setDbFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_USER_ROWS_PER_PAGE);
  const [editorMode, setEditorMode] = useState('edit');
  const [draft, setDraft] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const activeSessionCounts = useMemo(() => {
    const counts = new Map();
    sessions
      .filter((item) => item.status === 'active')
      .forEach((session) => {
        counts.set(session.user_id, Number(counts.get(session.user_id) || 0) + 1);
      });
    return counts;
  }, [sessions]);

  const metrics = useMemo(() => ({
    total: users.length,
    active: users.filter((item) => item.is_active).length,
    ldap: users.filter((item) => item.auth_source === 'ldap').length,
    custom: users.filter((item) => item.use_custom_permissions).length,
  }), [users]);

  const activeFilterCount = useMemo(() => (
    [
      search.trim() ? 'search' : null,
      statusFilter !== 'all' ? 'status' : null,
      roleFilter !== 'all' ? 'role' : null,
      sourceFilter !== 'all' ? 'source' : null,
      dbFilter !== 'all' ? 'db' : null,
    ].filter(Boolean).length
  ), [dbFilter, roleFilter, search, sourceFilter, statusFilter]);

  const filteredUsers = useMemo(() => {
    const rolePriority = { admin: 0, operator: 1, viewer: 2 };
    return users
      .filter((item) => matchesUserSearch(item, search))
      .filter((item) => statusFilter === 'all' ? true : statusFilter === 'active' ? item.is_active : !item.is_active)
      .filter((item) => roleFilter === 'all' ? true : item.role === roleFilter)
      .filter((item) => sourceFilter === 'all' ? true : item.auth_source === sourceFilter)
      .filter((item) => dbFilter === 'all' ? true : String(item.assigned_database || '') === dbFilter)
      .sort((left, right) => {
        if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
        const leftRole = rolePriority[left.role] ?? 9;
        const rightRole = rolePriority[right.role] ?? 9;
        if (leftRole !== rightRole) return leftRole - rightRole;
        return String(left.full_name || left.username || '').localeCompare(String(right.full_name || right.username || ''), 'ru');
      });
  }, [users, search, statusFilter, roleFilter, sourceFilter, dbFilter]);

  const pagedUsers = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredUsers.slice(start, start + rowsPerPage);
  }, [filteredUsers, page, rowsPerPage]);

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, roleFilter, sourceFilter, dbFilter]);

  useEffect(() => {
    if (!draft?.id) return;
    const exists = users.some((item) => Number(item.id) === Number(draft.id));
    if (!exists) {
      setDraft(null);
      setDrawerOpen(false);
    }
  }, [users, draft?.id]);

  const linkedSessions = useMemo(() => {
    if (!draft?.id) return [];
    return sessions.filter((item) => Number(item.user_id) === Number(draft.id) && item.status === 'active');
  }, [draft?.id, sessions]);

  const openCreate = useCallback(() => {
    setEditorMode('create');
    setDraft(createEmptyUserDraft());
    if (!isVeryWide) {
      setDrawerOpen(true);
    }
  }, [isVeryWide]);

  const openEdit = useCallback((item) => {
    setEditorMode('edit');
    setDraft(createUserDraftFromItem(item));
    if (!isVeryWide) {
      setDrawerOpen(true);
    }
  }, [isVeryWide]);

  const closeEditor = useCallback(() => {
    if (savingUser) return;
    setDrawerOpen(false);
    if (!isVeryWide) {
      setDraft(null);
    }
  }, [isVeryWide, savingUser]);

  const handleDraftChange = useCallback((field, value) => {
    setDraft((prev) => ({ ...(prev || {}), [field]: value }));
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!draft) return;
    const payload = {
      ...draft,
      username: String(draft.username || '').trim(),
      full_name: String(draft.full_name || '').trim(),
      department: String(draft.department || '').trim(),
      job_title: String(draft.job_title || '').trim(),
      email: String(draft.email || '').trim(),
      mailbox_email: String(draft.mailbox_email || '').trim(),
      mailbox_login: String(draft.mailbox_login || '').trim(),
      telegram_id: String(draft.telegram_id || '').trim(),
      assigned_database: draft.assigned_database || '',
      custom_permissions: normalizePermissions(draft.custom_permissions),
    };

    if (payload.username.length < 3) return;
    if (payload.telegram_id && !Number.isInteger(Number(payload.telegram_id))) return;

    const result = editorMode === 'create'
      ? await onCreateUser(payload)
      : await onUpdateUser(payload);

    if (!result?.ok) return;
    if (!isVeryWide) {
      setDrawerOpen(false);
      setDraft(null);
    } else if (result.user) {
      setDraft(createUserDraftFromItem(result.user));
    }
  }, [draft, editorMode, isVeryWide, onCreateUser, onUpdateUser]);

  const tableRows = pagedUsers.map((item) => {
    const roleMeta = roleOptions.find((option) => option.value === item.role);
    const activeSessions = Number(activeSessionCounts.get(item.id) || 0);
    return (
      <TableRow
        hover
        key={item.id}
        onClick={() => openEdit(item)}
        selected={Number(draft?.id) === Number(item.id)}
        sx={{
          cursor: 'pointer',
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
          },
          '& .MuiTableCell-body': {
            py: 0.58,
            verticalAlign: 'middle',
            borderBottomColor: theme.customAdmin?.border || 'divider',
          },
        }}
      >
        <TableCell sx={{ minWidth: 220 }}>
          <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            {item.full_name || item.username}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15, lineHeight: 1.2 }}>
            {[item.job_title, item.department].filter(Boolean).join(' · ') || 'Должность и отдел не указаны'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }}>
            @{item.username}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 150 }}>
          <Chip size="small" color={roleMeta?.color || 'default'} label={roleMeta?.label || item.role} sx={{ mb: 0.3, height: 22 }} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
            {item.use_custom_permissions ? `${normalizePermissions(item.custom_permissions).length} прав` : 'По роли'}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 210 }}>
          <Stack direction="row" spacing={0.55} flexWrap="wrap" useFlexGap sx={{ mb: 0.3 }}>
            <Chip size="small" variant="outlined" label={item.auth_source === 'ldap' ? 'AD / LDAP' : 'Локальная'} sx={{ height: 22 }} />
            <Chip size="small" variant="outlined" label={item.telegram_id ? 'TG' : 'Без TG'} sx={{ height: 22 }} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {getDbName(dbOptions, item.assigned_database)}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 210 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {item.mailbox_email || 'Профиль не задан'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {item.mailbox_login || buildDefaultExchangeLoginPreview(item.username)}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 120 }}>
          <Chip size="small" color={item.is_active ? 'success' : 'default'} label={item.is_active ? 'Активен' : 'Отключён'} sx={{ mb: 0.3, height: 22 }} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
            {activeSessions} сесс.
          </Typography>
        </TableCell>
        <TableCell align="right" sx={{ width: 52 }}>
          <OverflowMenu
            label="Действия с пользователем"
            items={[
              { key: 'open', label: 'Открыть' },
              {
                key: 'delete',
                label: 'Удалить',
                tone: 'danger',
                disabled: Number(item.id) === 1 || Number(item.id) === Number(currentUserId),
                icon: <DeleteOutlineOutlinedIcon fontSize="small" />,
              },
            ]}
            onSelect={(key) => {
              if (key === 'open') openEdit(item);
              if (key === 'delete') setDeleteTarget(item);
            }}
          />
        </TableCell>
      </TableRow>
    );
  });

  const editorContent = draft ? (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ px: 1.6, py: 1.25, display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {editorMode === 'create' ? 'Новый пользователь' : (draft.full_name || draft.username || 'Редактор пользователя')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block', lineHeight: 1.35 }}>
            {editorMode === 'create' ? 'Создание новой учётной записи.' : `@${draft.username || 'new'} • ${roleOptions.find((item) => item.value === draft.role)?.label || draft.role}`}
          </Typography>
        </Box>
        {!isVeryWide ? (
          <IconButton onClick={closeEditor} disabled={savingUser} size="small">
            <VisibilityOffOutlinedIcon fontSize="small" />
          </IconButton>
        ) : null}
      </Box>
      <Divider />
      <Box sx={{ p: 1.5, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <UserDraftFields draft={draft} onChange={handleDraftChange} dbOptions={dbOptions} linkedSessions={linkedSessions} users={users} />
      </Box>
      <Divider />
      <Box sx={{ px: 1.6, py: 1.15, display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
          Изменения применяются сразу после сохранения.
        </Typography>
        <Stack direction="row" spacing={1}>
          {!isVeryWide ? <Button variant="outlined" onClick={closeEditor} disabled={savingUser}>Закрыть</Button> : null}
          <Button variant="contained" onClick={handleSaveDraft} disabled={savingUser || !draft}>
            {savingUser ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </Stack>
      </Box>
    </Box>
  ) : (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 3 }}>
      <Stack spacing={0.75} sx={{ maxWidth: 260 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Редактор</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
          Выберите строку в таблице или создайте нового пользователя.
        </Typography>
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, height: '100%' }}>
      <SectionCard sx={{ flexShrink: 0 }} contentSx={{ p: 1.1 }}>
        <Stack spacing={1}>
          <Stack
            direction={{ xs: 'column', xl: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', xl: 'center' }}
          >
            <TextField
              fullWidth
              size="small"
              type="search"
              label="Поиск пользователя"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              inputProps={{ autoComplete: 'off', spellCheck: 'false' }}
              InputProps={{ startAdornment: <SearchOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
              sx={{ flex: 1, minWidth: 0 }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexShrink: 0 }}>
              <Button
                variant={filtersExpanded || activeFilterCount ? 'contained' : 'outlined'}
                onClick={() => setFiltersExpanded((prev) => !prev)}
                endIcon={
                  <ExpandMoreOutlinedIcon
                    sx={{
                      transition: 'transform 0.2s ease',
                      transform: filtersExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  />
                }
              >
                {activeFilterCount ? `Фильтры (${activeFilterCount})` : 'Фильтры'}
              </Button>
              <Button size="small" variant="outlined" startIcon={<AddOutlinedIcon />} onClick={openCreate}>
                Новый пользователь
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                startIcon={syncingAD ? <CircularProgress size={18} color="inherit" /> : <SyncOutlinedIcon />}
                onClick={onSyncAD}
                disabled={syncingAD}
              >
                {syncingAD ? 'Синхронизация...' : 'Синхронизировать'}
              </Button>
            </Stack>
          </Stack>

          <Collapse in={filtersExpanded} timeout="auto" unmountOnExit>
            <Stack spacing={1.25} sx={{ pt: 0.25 }}>
              <Grid container spacing={1.25}>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Статус</InputLabel>
                    <Select label="Статус" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                      <MenuItem value="all">Все</MenuItem>
                      <MenuItem value="active">Активные</MenuItem>
                      <MenuItem value="inactive">Отключённые</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Роль</InputLabel>
                    <Select label="Роль" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                      <MenuItem value="all">Все</MenuItem>
                      {roleOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Источник</InputLabel>
                    <Select label="Источник" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                      <MenuItem value="all">Все</MenuItem>
                      <MenuItem value="local">Локальная</MenuItem>
                      <MenuItem value="ldap">AD / LDAP</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>База</InputLabel>
                    <Select label="База" value={dbFilter} onChange={(event) => setDbFilter(event.target.value)}>
                      <MenuItem value="all">Все</MenuItem>
                      <MenuItem value="">Не ограничивать</MenuItem>
                      {dbOptions.map((db) => (
                        <MenuItem key={db.id} value={db.id}>{db.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  Показаны только отфильтрованные записи. Поиск работает по логину, имени, должности, отделу, email и Telegram ID.
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<RefreshOutlinedIcon fontSize="small" />}
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                    setRoleFilter('all');
                    setSourceFilter('all');
                    setDbFilter('all');
                  }}
                >
                  Сбросить
                </Button>
              </Stack>
            </Stack>
          </Collapse>

          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            {activeFilterCount > 0
              ? `Активных фильтров: ${activeFilterCount}. Найдено записей: ${filteredUsers.length}.`
              : 'Клик по строке открывает редактор. Таблица остаётся плотной, детали вынесены в правую панель.'}
          </Typography>
        </Stack>
      </SectionCard>

      <Grid container spacing={0.85} sx={{ flexShrink: 0 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricTile compact icon={<GroupOutlinedIcon fontSize="small" />} label="Всего" value={metrics.total} caption="Учётные записи" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricTile compact icon={<CheckCircleOutlineOutlinedIcon fontSize="small" />} label="Активные" value={metrics.active} caption="Могут войти" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricTile compact icon={<ShieldOutlinedIcon fontSize="small" />} label="LDAP / AD" value={metrics.ldap} caption="Через AD" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricTile compact icon={<TuneOutlinedIcon fontSize="small" />} label="Свои права" value={metrics.custom} caption="Custom permissions" />
        </Grid>
      </Grid>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: isVeryWide ? 'minmax(0, 1fr) 620px' : 'minmax(0, 1fr)',
          gap: 1.25,
          minHeight: 0,
          flex: 1,
        }}
      >
        <SectionCard
          title="Список"
          action={<Chip size="small" label={`${filteredUsers.length} записей`} />}
          sx={{ minHeight: 0 }}
          contentSx={{ p: 0 }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <TableContainer sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <Table
                stickyHeader
                size="small"
                sx={{
                  minWidth: 900,
                  '& .MuiTableCell-head': {
                    py: 0.55,
                    backgroundColor: ui.headerBandBg,
                    fontSize: '0.76rem',
                    borderBottomColor: ui.headerBandBorder,
                  },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Пользователь</TableCell>
                    <TableCell>Доступ</TableCell>
                    <TableCell>Интеграции</TableCell>
                    <TableCell>Почта</TableCell>
                    <TableCell>Статус</TableCell>
                    <TableCell align="right">...</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 4, textAlign: 'center' }}>
                        <CircularProgress size={24} />
                      </TableCell>
                    </TableRow>
                  ) : tableRows.length > 0 ? tableRows : (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                        Пользователи не найдены.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={filteredUsers.length}
              page={page}
              onPageChange={(_, nextPage) => setPage(nextPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={USER_ROWS_PER_PAGE_OPTIONS}
              labelRowsPerPage="Строк на странице"
              labelDisplayedRows={({ from, to, count }) => `${from}-${to} из ${count}`}
            />
          </Box>
        </SectionCard>

        {isVeryWide ? (
          <Paper variant="outlined" sx={{ borderRadius: '14px', minHeight: 0, overflow: 'hidden' }}>
            {editorContent}
          </Paper>
        ) : (
          <Drawer
            anchor="right"
            open={drawerOpen}
            onClose={closeEditor}
            PaperProps={{ sx: { width: { xs: '100vw', sm: 620 }, maxWidth: '100vw' } }}
          >
            {editorContent}
          </Drawer>
        )}
      </Box>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Удаление пользователя</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Удалить пользователя <strong>{deleteTarget?.username}</strong>? Это действие необратимо.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (!deleteTarget) return;
              const result = await onDeleteUser(deleteTarget);
              if (result?.ok && Number(draft?.id) === Number(deleteTarget.id)) {
                setDraft(null);
                setDrawerOpen(false);
              }
              if (result?.ok) {
                setDeleteTarget(null);
              }
            }}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SessionsTab({ sessions, loading, cleanupResult, cleaning, purging, onCleanup, onPurge, onTerminate }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const metrics = useMemo(() => ({
    active: sessions.filter((item) => item.status === 'active').length,
  }), [sessions]);
  const visibleSessions = sessions;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, height: '100%' }}>
      <SectionCard
        description="Живые и недавно закрытые сессии с единым lifecycle cleanup."
        action={(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            variant="outlined"
            startIcon={cleaning ? <CircularProgress size={18} color="inherit" /> : <BuildCircleOutlinedIcon />}
            onClick={onCleanup}
            disabled={cleaning || purging}
          >
            {cleaning ? 'Очистка...' : 'Очистить устаревшие'}
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={purging ? <CircularProgress size={18} color="inherit" /> : <DeleteOutlineOutlinedIcon />}
            onClick={onPurge}
            disabled={purging || cleaning}
          >
            {purging ? 'Удаление...' : 'Удалить неактивные'}
          </Button>
          </Stack>
        )}
        sx={{ flexShrink: 0 }}
        contentSx={{ p: 1.05 }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
          Основные действия вынесены в компактное меню, чтобы таблица оставалась уже и чище.
        </Typography>
      </SectionCard>

      <Grid container spacing={0.85} sx={{ flexShrink: 0 }}>
        <Grid item xs={12} sm={6} lg={6}>
          <MetricTile compact icon={<CheckCircleOutlineOutlinedIcon fontSize="small" />} label="Активные" value={metrics.active} caption="Доступны прямо сейчас" />
        </Grid>
        <Grid item xs={12} sm={6} lg={6}>
          <MetricTile compact icon={<BuildCircleOutlinedIcon fontSize="small" />} label="Cleanup" value={cleanupResult.deleted} caption={`Удалено: ${cleanupResult.deleted}, деактивировано: ${cleanupResult.deactivated}`} />
        </Grid>
      </Grid>

      <SectionCard title="Список входов" action={<Chip size="small" label={`${visibleSessions.length} записей`} />} sx={{ minHeight: 0 }} contentSx={{ p: 0 }}>
        <TableContainer sx={{ minHeight: 0, height: '100%', overflowY: 'auto' }}>
          <Table
            stickyHeader
            size="small"
            sx={{
              minWidth: 980,
              '& .MuiTableCell-head': {
                py: 0.55,
                backgroundColor: ui.headerBandBg,
                fontSize: '0.76rem',
                borderBottomColor: ui.headerBandBorder,
              },
              '& .MuiTableCell-body': {
                py: 0.58,
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>Пользователь</TableCell>
                <TableCell>Устройство</TableCell>
                <TableCell>IP</TableCell>
                <TableCell>Создана</TableCell>
                <TableCell>Активность</TableCell>
                <TableCell>Истекает</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell align="right">...</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : visibleSessions.length > 0 ? visibleSessions.map((session) => {
                const meta = sessionStatusMeta[session.status] || sessionStatusMeta.terminated;
                return (
                  <TableRow key={session.session_id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{session.username}</Typography>
                      <Typography variant="caption" color="text.secondary">{session.role}</Typography>
                    </TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{session.device_label || 'Устройство'}</Typography>
                      <Typography variant="caption" color="text.secondary">{session.user_agent || '—'}</Typography>
                    </TableCell>
                    <TableCell>{session.ip_address || '—'}</TableCell>
                    <TableCell>{formatDateTime(session.created_at)}</TableCell>
                    <TableCell>{formatDateTime(session.last_seen_at)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatDateTime(session.expires_at)}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatDateTime(session.idle_expires_at)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" color={meta.color} label={meta.label} />
                    </TableCell>
                    <TableCell align="right">
                      <OverflowMenu
                        label="Действия с сессией"
                        items={[
                          { key: 'terminate', label: 'Завершить', tone: 'danger', disabled: session.status !== 'active', icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
                        ]}
                        onSelect={(key) => {
                          if (key === 'terminate') onTerminate(session.session_id);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    Сессии не найдены.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
    </Box>
  );
}

function EnvVariablesTab({ envState, loading, saving, onRefresh, onSave }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isHelpWide = useMediaQuery(ENV_HELP_WIDE_QUERY);
  const [search, setSearch] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [draftValues, setDraftValues] = useState({});
  const [activatedFields, setActivatedFields] = useState({});
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const next = {};
    (envState?.items || []).forEach((item) => {
      next[item.key] = item.value ?? '';
    });
    setDraftValues(next);
    setActivatedFields({});
  }, [envState?.items]);

  const filteredItems = useMemo(() => {
    const needle = String(search || '').trim().toLowerCase();
    const items = Array.isArray(envState?.items) ? envState.items : [];
    if (!needle) return items;
    return items.filter((item) => (
      String(item.key || '').toLowerCase().includes(needle)
      || String(item.description || '').toLowerCase().includes(needle)
      || String(item.category || '').toLowerCase().includes(needle)
    ));
  }, [envState?.items, search]);

  const groupedItems = useMemo(() => {
    const groups = new Map();
    filteredItems.forEach((item) => {
      const category = item.category || 'Прочее';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    });
    return Array.from(groups.entries());
  }, [filteredItems]);

  const dirtyCount = useMemo(() => {
    const original = new Map((envState?.items || []).map((item) => [item.key, item.value ?? '']));
    return Object.keys(draftValues).filter((key) => (draftValues[key] ?? '') !== (original.get(key) ?? '')).length;
  }, [draftValues, envState?.items]);

  const renderValueField = (item) => {
    const inputType = item.is_sensitive && !showSecrets ? 'password' : 'text';
    const fieldName = `env_${item.key.toLowerCase()}_${String(item.category || 'misc').toLowerCase().replace(/\s+/g, '_')}`;
    return (
      <TextField
        fullWidth
        size="small"
        type={inputType}
        label="Значение"
        value={draftValues[item.key] ?? ''}
        onFocus={() => setActivatedFields((prev) => ({ ...prev, [item.key]: true }))}
        onChange={(event) => setDraftValues((prev) => ({ ...prev, [item.key]: event.target.value }))}
        autoComplete="new-password"
        name={fieldName}
        inputProps={{
          autoComplete: 'new-password',
          spellCheck: 'false',
          readOnly: !activatedFields[item.key],
        }}
      />
    );
  };

  const renderHelpPanel = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25 }}>
        <Stack spacing={1}>
          <Accordion defaultExpanded disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Что нужно применить</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.2 }}>
              <Stack spacing={1}>
                {(envState?.apply_plan || []).length > 0 ? envState.apply_plan.map((item) => (
                  <Paper key={item.target} variant="outlined" sx={{ p: 1.1, borderRadius: '12px' }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>{item.label}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.35 }}>
                      {item.apply_hint}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.55, color: 'text.secondary', overflowWrap: 'anywhere' }}>
                      {item.keys.join(', ')}
                    </Typography>
                  </Paper>
                )) : (
                  <Typography variant="body2" color="text.secondary">
                    После сохранения здесь появится список действий для backend, scan, бота и frontend.
                  </Typography>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>

          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Последние изменения</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.2 }}>
              <Stack spacing={1}>
                {(envState?.recent_changes || []).length > 0 ? envState.recent_changes.map((item, index) => (
                  <Paper key={`${item.key}-${item.changed_at}-${index}`} variant="outlined" sx={{ p: 1.1, borderRadius: '12px' }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>{item.key}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.35 }}>
                      {item.actor_username || 'system'} • {formatDateTime(item.changed_at)}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.55, lineHeight: 1.35 }}>
                      {item.old_value_masked} → {item.new_value_masked}
                    </Typography>
                  </Paper>
                )) : (
                  <Typography variant="body2" color="text.secondary">Изменений пока нет.</Typography>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>

          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Команды PM2</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.2 }}>
              <Stack spacing={1}>
                {staticRunbook.pm2.map((command) => (
                  <Paper
                    key={command}
                    variant="outlined"
                    sx={getOfficeSubtlePanelSx(ui, { p: 1.05, borderRadius: '12px', bgcolor: ui.actionBg })}
                  >
                    <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {command}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>

          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Frontend и VITE_*</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.2 }}>
              <Stack spacing={1}>
                {staticRunbook.frontend.map((command) => (
                  <Paper
                    key={command}
                    variant="outlined"
                    sx={getOfficeSubtlePanelSx(ui, { p: 1.05, borderRadius: '12px', bgcolor: ui.actionBg })}
                  >
                    <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {command}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Stack>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, height: '100%' }}>
      <SectionCard sx={{ flexShrink: 0 }} contentSx={{ p: 1.1 }}>
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1} alignItems={{ xs: 'stretch', xl: 'center' }}>
            <TextField
              fullWidth
              size="small"
              type="search"
              label="Поиск переменной"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              name="env-search-field"
              inputProps={{ autoComplete: 'off', spellCheck: 'false' }}
              InputProps={{ startAdornment: <SearchOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
              sx={{ flex: 1, minWidth: 0 }}
            />
            <FormControlLabel
              control={<Switch checked={showSecrets} onChange={(event) => setShowSecrets(event.target.checked)} />}
              label="Секреты"
              sx={{ m: 0, flexShrink: 0 }}
            />
            <Button
              variant={helpOpen ? 'contained' : 'outlined'}
              onClick={() => setHelpOpen((prev) => !prev)}
              endIcon={(
                <ExpandMoreOutlinedIcon
                  sx={{
                    transition: 'transform 0.2s ease',
                    transform: helpOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
              )}
            >
              Помощь и применение
            </Button>
            <Button variant="outlined" startIcon={<RefreshOutlinedIcon />} onClick={onRefresh} disabled={loading || saving}>Обновить</Button>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
              onClick={() => onSave(draftValues)}
              disabled={saving || dirtyCount === 0}
            >
              {saving ? 'Сохранение...' : `Сохранить${dirtyCount ? ` (${dirtyCount})` : ''}`}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            Редактор .env доступен только администратору. Пустое значение сохранится как KEY=. {dirtyCount > 0 ? `Изменено полей: ${dirtyCount}.` : 'Изменений пока нет.'}
          </Typography>
        </Stack>
      </SectionCard>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: isHelpWide && helpOpen ? 'minmax(0, 1fr) 300px' : 'minmax(0, 1fr)',
          gap: 1.25,
          minHeight: 0,
          flex: 1,
        }}
      >
        <SectionCard title="Редактор .env" action={<Chip size="small" label={`${filteredItems.length} перем.`} />} sx={{ minHeight: 0 }} contentSx={{ p: 0 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25 }}>
              {loading ? (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <CircularProgress size={26} />
                </Box>
              ) : groupedItems.length > 0 ? groupedItems.map(([category, items]) => (
                <Accordion
                  key={category}
                  defaultExpanded
                  disableGutters
                  sx={{
                    mb: 1,
                    bgcolor: 'transparent',
                    border: '1px solid',
                    borderColor: theme.customAdmin?.border || 'divider',
                    borderRadius: '12px !important',
                    overflow: 'hidden',
                    '&:before': { display: 'none' },
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>{category}</Typography>
                      <Chip size="small" label={items.length} />
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 0.85 }}>
                    <Stack spacing={0.85}>
                      {items.map((item) => (
                        <Paper key={item.key} variant="outlined" sx={{ p: 0.9, borderRadius: '10px', borderColor: theme.customAdmin?.border || 'divider' }}>
                          <Stack spacing={0.7}>
                            <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" spacing={0.75}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{item.key}</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.2, lineHeight: 1.35 }}>
                                  {item.description}
                                </Typography>
                              </Box>
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {item.is_sensitive ? <Chip size="small" color="warning" label="Секрет" /> : <Chip size="small" variant="outlined" label="Обычная" />}
                                {item.apply_target_labels.map((label) => (
                                  <Chip key={`${item.key}-${label}`} size="small" variant="outlined" label={label} />
                                ))}
                              </Stack>
                            </Stack>
                            {renderValueField(item)}
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              )) : (
                <Typography variant="body2" color="text.secondary">По фильтру ничего не найдено.</Typography>
              )}
            </Box>
          </Box>
        </SectionCard>

        {isHelpWide && helpOpen ? (
          <SectionCard title="Помощь и применение" sx={{ minHeight: 0 }} contentSx={{ p: 0 }}>
            {renderHelpPanel()}
          </SectionCard>
        ) : null}
      </Box>

      {!isHelpWide && helpOpen ? (
        <SectionCard title="Помощь и применение" sx={{ flexShrink: 0 }} contentSx={{ p: 0 }}>
          {renderHelpPanel()}
        </SectionCard>
      ) : null}
    </Box>
  );
}

function normalizeIpListForSettings(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  return items.reduce((acc, item) => {
    const normalized = String(item || '').trim();
    if (!normalized || seen.has(normalized)) {
      return acc;
    }
    seen.add(normalized);
    acc.push(normalized);
    return acc;
  }, []);
}

function normalizeAppSettingsState(data) {
  return {
    transfer_act_reminder_controller_username: String(data?.transfer_act_reminder_controller_username || '').trim().toLowerCase(),
    admin_login_allowed_ips: normalizeIpListForSettings(data?.admin_login_allowed_ips),
    available_controllers: Array.isArray(data?.available_controllers) ? data.available_controllers : [],
    resolved_controller: data?.resolved_controller || null,
    resolved_controller_source: String(data?.resolved_controller_source || 'none'),
    fallback_used: Boolean(data?.fallback_used),
    warning: String(data?.warning || ''),
  };
}

export function AdminLoginAllowlistSettingsCard({ appSettings, loading, saving, onSave }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [draftIps, setDraftIps] = useState('');
  const [localError, setLocalError] = useState('');

  const currentIps = useMemo(
    () => normalizeIpListForSettings(appSettings?.admin_login_allowed_ips),
    [appSettings?.admin_login_allowed_ips],
  );

  useEffect(() => {
    setDraftIps(currentIps.join('\n'));
    setLocalError('');
  }, [currentIps]);

  const parsedIps = useMemo(() => {
    const seen = new Set();
    return String(draftIps || '')
      .split(/\r?\n/)
      .map((item) => String(item || '').trim())
      .filter((item) => {
        if (!item || seen.has(item)) {
          return false;
        }
        seen.add(item);
        return true;
      });
  }, [draftIps]);

  const dirty = parsedIps.join('\n') !== currentIps.join('\n');

  const handleSave = () => {
    if (parsedIps.length === 0) {
      setLocalError('Укажите хотя бы один IP-адрес для входа admin.');
      return;
    }
    setLocalError('');
    onSave({ admin_login_allowed_ips: parsedIps });
  };

  return (
    <SectionCard
      title="IP allowlist для admin"
      action={<Chip size="small" label={`${currentIps.length} IP`} color={currentIps.length > 0 ? 'success' : 'default'} />}
      sx={{ flexShrink: 0 }}
      contentSx={{ p: 1.1 }}
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
          Разрешите вход admin-учёток только с доверенных адресов. Указывайте один точный IP на строку, например <strong>10.105.0.42</strong>.
        </Typography>

        <TextField
          label="Разрешённые IP"
          multiline
          minRows={4}
          fullWidth
          size="small"
          value={draftIps}
          onChange={(event) => {
            setDraftIps(event.target.value);
            if (localError) {
              setLocalError('');
            }
          }}
          disabled={loading || saving}
          placeholder={'10.105.0.42\n10.105.0.43'}
          helperText="Один IP на строку. Невалидные адреса backend не сохранит."
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
            onClick={handleSave}
            disabled={loading || saving || !dirty}
          >
            {saving ? 'Сохранение...' : 'Сохранить allowlist'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            Ограничение применяется и к новым логинам, и к уже активным admin-сессиям.
          </Typography>
        </Stack>

        {localError ? <Alert severity="error">{localError}</Alert> : null}

        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, { p: 1.05, borderRadius: '12px', bgcolor: ui.actionBg })}
        >
          <Stack spacing={0.75}>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
              Сейчас разрешены
            </Typography>
            {currentIps.length > 0 ? (
              <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                {currentIps.map((ip) => (
                  <Chip key={ip} size="small" label={ip} color="success" variant="outlined" />
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Список пока пуст.
              </Typography>
            )}
          </Stack>
        </Paper>
      </Stack>
    </SectionCard>
  );
}

export function TransferActReminderSettingsCard({ appSettings, loading, saving, onSave }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [draftUsername, setDraftUsername] = useState('');

  useEffect(() => {
    setDraftUsername(String(appSettings?.transfer_act_reminder_controller_username || '').trim().toLowerCase());
  }, [appSettings?.transfer_act_reminder_controller_username]);

  const controllers = useMemo(
    () => (Array.isArray(appSettings?.available_controllers) ? appSettings.available_controllers : []),
    [appSettings?.available_controllers],
  );

  const currentUsername = String(appSettings?.transfer_act_reminder_controller_username || '').trim().toLowerCase();
  const resolvedController = appSettings?.resolved_controller || null;
  const resolvedSource = String(appSettings?.resolved_controller_source || 'none').trim().toLowerCase();
  const warning = String(appSettings?.warning || '').trim();
  const dirty = draftUsername !== currentUsername;
  const hasCurrentOption = controllers.some((item) => String(item?.username || '').trim().toLowerCase() === currentUsername);

  return (
    <SectionCard
      title="Web-настройки reminder-задач"
      action={
        <Chip
          size="small"
          color={resolvedSource === 'configured' ? 'success' : (resolvedSource === 'fallback' ? 'warning' : 'default')}
          label={resolvedSource === 'configured' ? 'Из настройки' : (resolvedSource === 'fallback' ? 'Fallback' : 'Не разрешён')}
        />
      }
      sx={{ flexShrink: 0 }}
      contentSx={{ p: 1.1 }}
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
          Здесь задаётся контролёр по умолчанию для reminder-задач о загрузке подписанных актов перемещения.
          Исполнителем задачи останется создатель перемещения.
        </Typography>

        <FormControl fullWidth size="small" disabled={loading || saving}>
          <InputLabel>Контролёр по умолчанию</InputLabel>
          <Select
            value={draftUsername}
            label="Контролёр по умолчанию"
            onChange={(event) => setDraftUsername(String(event.target.value || '').trim().toLowerCase())}
          >
            {!hasCurrentOption && currentUsername ? (
              <MenuItem value={currentUsername}>
                {currentUsername} (недоступен)
              </MenuItem>
            ) : null}
            {controllers.map((item) => (
              <MenuItem key={item.username} value={String(item.username || '').trim().toLowerCase()}>
                {(item.full_name || item.username)} (@{item.username})
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
            onClick={() => onSave({ transfer_act_reminder_controller_username: draftUsername || null })}
            disabled={loading || saving || !dirty}
          >
            {saving ? 'Сохранение...' : 'Сохранить контролёра'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            Разрешены активные admin или пользователи с правом <strong>`tasks.review`</strong>.
          </Typography>
        </Stack>

        {warning ? (
          <Alert severity="warning">{warning}</Alert>
        ) : null}

        {resolvedController ? (
          <Paper
            variant="outlined"
            sx={getOfficeSubtlePanelSx(ui, { p: 1.05, borderRadius: '12px', bgcolor: ui.actionBg })}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
                  Сейчас будет использован
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  {resolvedController.full_name || resolvedController.username}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  @{resolvedController.username} • роль: {resolvedController.role || 'viewer'}
                </Typography>
              </Box>
              <Chip
                size="small"
                color={resolvedSource === 'configured' ? 'success' : 'warning'}
                label={resolvedSource === 'configured' ? 'Из настройки' : 'Авто fallback'}
              />
            </Stack>
          </Paper>
        ) : (
          <Alert severity="error">
            Не найден ни один активный admin или пользователь с правом <strong>`tasks.review`</strong>.
          </Alert>
        )}
      </Stack>
    </SectionCard>
  );
}

const AI_ITINVENT_DEFAULT_TOOLS = [
  'itinvent.database.current',
  'itinvent.equipment.search',
  'itinvent.equipment.search_universal',
  'itinvent.equipment.get_card',
  'itinvent.equipment.list_by_branch',
  'itinvent.employee.search',
  'itinvent.employee.list_equipment',
  'itinvent.consumables.search',
  'itinvent.directory.branches',
  'itinvent.directory.locations',
  'itinvent.directory.equipment_types',
  'itinvent.directory.statuses',
];

const AI_ITINVENT_TOOL_OPTIONS = [
  { id: 'itinvent.database.current', label: 'Текущая база' },
  { id: 'itinvent.equipment.search', label: 'Поиск оборудования' },
  { id: 'itinvent.equipment.search_universal', label: 'Универсальный поиск оборудования' },
  { id: 'itinvent.equipment.get_card', label: 'Карточка устройства' },
  { id: 'itinvent.equipment.list_by_branch', label: 'Оборудование филиала' },
  { id: 'itinvent.employee.search', label: 'Поиск сотрудника' },
  { id: 'itinvent.employee.list_equipment', label: 'Оборудование сотрудника' },
  { id: 'itinvent.consumables.search', label: 'Расходники и комплектующие' },
  { id: 'itinvent.directory.branches', label: 'Справочник филиалов' },
  { id: 'itinvent.directory.locations', label: 'Справочник локаций' },
  { id: 'itinvent.directory.equipment_types', label: 'Справочник типов оборудования' },
  { id: 'itinvent.directory.statuses', label: 'Справочник статусов' },
  { id: 'itinvent.equipment.search_multi_db', label: 'Мульти-БД поиск (admin)' },
];

const getAiBotEnabledTools = (value) => (
  Array.isArray(value?.enabled_tools) ? value.enabled_tools.map((item) => String(item).trim()).filter(Boolean) : []
);

const isAiBotLiveDataEnabled = (value) => getAiBotEnabledTools(value).length > 0;

const shouldWarnAiBotLiveDataDisabled = (value) => (
  Boolean(value?.is_enabled ?? true) && !isAiBotLiveDataEnabled(value)
);

const createAiBotDraft = (value = {}) => ({
  title: String(value?.title || '').trim(),
  slug: String(value?.slug || '').trim(),
  description: String(value?.description || '').trim(),
  system_prompt: String(value?.system_prompt || '').trim(),
  model: String(value?.model || '').trim(),
  temperature: Number(value?.temperature ?? 0.2),
  max_tokens: Number(value?.max_tokens ?? 2000),
  allow_file_input: Boolean(value?.allow_file_input ?? true),
  allow_generated_artifacts: Boolean(value?.allow_generated_artifacts ?? true),
  allow_kb_document_delivery: Boolean(value?.allow_kb_document_delivery ?? false),
  is_enabled: Boolean(value?.is_enabled ?? true),
  allowed_kb_scope: Array.isArray(value?.allowed_kb_scope) ? value.allowed_kb_scope.join(', ') : '',
  enabled_tools: Array.isArray(value?.enabled_tools) ? value.enabled_tools.map((item) => String(item).trim()).filter(Boolean) : [],
  multi_db_mode: String(value?.tool_settings?.multi_db_mode || 'single').trim() || 'single',
  allowed_databases: Array.isArray(value?.tool_settings?.allowed_databases)
    ? value.tool_settings.allowed_databases.map((item) => String(item).trim()).filter(Boolean)
    : [],
});

export function AiBotsAdminSection({
  bots,
  loading,
  savingBotId,
  runsByBotId,
  onRefresh,
  onCreate,
  onSave,
  openrouterConfigured,
  dbOptions = [],
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [draftsById, setDraftsById] = useState({});
  const [newDraft, setNewDraft] = useState(() => createAiBotDraft({
    title: 'Новый AI бот',
    slug: 'new-ai-bot',
    description: '',
    system_prompt: '',
  }));

  useEffect(() => {
    setDraftsById(Object.fromEntries((Array.isArray(bots) ? bots : []).map((item) => [item.id, createAiBotDraft(item)])));
  }, [bots]);

  const updateDraft = useCallback((botId, key, value) => {
    setDraftsById((current) => ({
      ...current,
      [botId]: {
        ...(current[botId] || createAiBotDraft()),
        [key]: value,
      },
    }));
  }, []);

  const renderBotFieldsLegacy = (draft, onChange) => (
    <Grid container spacing={1.2}>
      <Grid item xs={12} md={6}>
        <TextField label="Название" fullWidth size="small" value={draft.title} onChange={(event) => onChange('title', event.target.value)} />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField label="Slug" fullWidth size="small" value={draft.slug} onChange={(event) => onChange('slug', event.target.value.toLowerCase())} />
      </Grid>
      <Grid item xs={12}>
        <TextField label="Описание" fullWidth size="small" value={draft.description} onChange={(event) => onChange('description', event.target.value)} />
      </Grid>
      <Grid item xs={12}>
        <TextField label="System prompt" fullWidth multiline minRows={4} value={draft.system_prompt} onChange={(event) => onChange('system_prompt', event.target.value)} />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField label="Модель" fullWidth size="small" value={draft.model} onChange={(event) => onChange('model', event.target.value)} placeholder="openai/gpt-4o-mini" />
      </Grid>
      <Grid item xs={6} md={2}>
        <TextField label="Temp" type="number" fullWidth size="small" value={draft.temperature} onChange={(event) => onChange('temperature', Number(event.target.value || 0))} />
      </Grid>
      <Grid item xs={6} md={2}>
        <TextField label="Max tokens" type="number" fullWidth size="small" value={draft.max_tokens} onChange={(event) => onChange('max_tokens', Number(event.target.value || 0))} />
      </Grid>
      <Grid item xs={12} md={4}>
        <TextField label="KB scope (через запятую)" fullWidth size="small" value={draft.allowed_kb_scope} onChange={(event) => onChange('allowed_kb_scope', event.target.value)} />
      </Grid>
      <Grid item xs={12}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <FormControlLabel control={<Switch checked={draft.allow_file_input} onChange={(event) => onChange('allow_file_input', event.target.checked)} />} label="Принимать файлы" />
          <FormControlLabel control={<Switch checked={draft.allow_generated_artifacts} onChange={(event) => onChange('allow_generated_artifacts', event.target.checked)} />} label="Генерировать файлы" />
          <FormControlLabel control={<Switch checked={draft.allow_kb_document_delivery} onChange={(event) => onChange('allow_kb_document_delivery', event.target.checked)} />} label="Отправлять KB-шаблоны" />
          <FormControlLabel control={<Switch checked={draft.is_enabled} onChange={(event) => onChange('is_enabled', event.target.checked)} />} label="Включён" />
        </Stack>
      </Grid>
    </Grid>
  );

  const renderBotFields = (draft, onChange) => {
    const enabledTools = getAiBotEnabledTools(draft);
    const liveDataEnabled = isAiBotLiveDataEnabled(draft);
    const liveDataWarning = shouldWarnAiBotLiveDataDisabled(draft);
    const allowedDatabases = Array.isArray(draft?.allowed_databases) ? draft.allowed_databases : [];

    const toggleLiveData = (checked) => {
      if (checked) {
        onChange('enabled_tools', enabledTools.length > 0 ? enabledTools : AI_ITINVENT_DEFAULT_TOOLS);
        return;
      }
      onChange('enabled_tools', []);
      onChange('multi_db_mode', 'single');
      onChange('allowed_databases', []);
    };

    const toggleTool = (toolId, checked) => {
      const normalizedToolId = String(toolId || '').trim();
      if (!normalizedToolId) return;
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, normalizedToolId])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => item !== normalizedToolId));
      if (normalizedToolId === 'itinvent.equipment.search_multi_db') {
        onChange('multi_db_mode', 'single');
        onChange('allowed_databases', []);
      }
    };

    return (
      <Grid container spacing={1.2}>
        <Grid item xs={12} md={6}>
          <TextField label="Название" fullWidth size="small" value={draft.title} onChange={(event) => onChange('title', event.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField label="Slug" fullWidth size="small" value={draft.slug} onChange={(event) => onChange('slug', event.target.value.toLowerCase())} />
        </Grid>
        <Grid item xs={12}>
          <TextField label="Описание" fullWidth size="small" value={draft.description} onChange={(event) => onChange('description', event.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <TextField label="System prompt" fullWidth multiline minRows={4} value={draft.system_prompt} onChange={(event) => onChange('system_prompt', event.target.value)} />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField label="Модель" fullWidth size="small" value={draft.model} onChange={(event) => onChange('model', event.target.value)} placeholder="openai/gpt-4o-mini" />
        </Grid>
        <Grid item xs={6} md={2}>
          <TextField label="Temp" type="number" fullWidth size="small" value={draft.temperature} onChange={(event) => onChange('temperature', Number(event.target.value || 0))} />
        </Grid>
        <Grid item xs={6} md={2}>
          <TextField label="Max tokens" type="number" fullWidth size="small" value={draft.max_tokens} onChange={(event) => onChange('max_tokens', Number(event.target.value || 0))} />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField label="KB scope (через запятую)" fullWidth size="small" value={draft.allowed_kb_scope} onChange={(event) => onChange('allowed_kb_scope', event.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <FormControlLabel control={<Switch checked={draft.allow_file_input} onChange={(event) => onChange('allow_file_input', event.target.checked)} />} label="Принимать файлы" />
            <FormControlLabel control={<Switch checked={draft.allow_generated_artifacts} onChange={(event) => onChange('allow_generated_artifacts', event.target.checked)} />} label="Генерировать файлы" />
            <FormControlLabel control={<Switch checked={draft.allow_kb_document_delivery} onChange={(event) => onChange('allow_kb_document_delivery', event.target.checked)} />} label="Отправлять KB-шаблоны" />
            <FormControlLabel control={<Switch checked={draft.is_enabled} onChange={(event) => onChange('is_enabled', event.target.checked)} />} label="Включён" />
          </Stack>
        </Grid>
        <Grid item xs={12}>
          <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Live data / ITinvent tools</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Read-only access to ITinvent data. Current KB/files flow remains unchanged while tools are disabled.
                  </Typography>
                </Box>
                <FormControlLabel
                  control={<Switch checked={liveDataEnabled} onChange={(event) => toggleLiveData(event.target.checked)} />}
                  label="ITinvent live data"
                />
              </Stack>

              {liveDataWarning ? (
                <Alert severity="warning">
                  This bot is enabled but has no live ITinvent tools saved. Chat will fall back to plain LLM answers until you enable ITinvent live data and save.
                </Alert>
              ) : null}

              <Collapse in={liveDataEnabled} unmountOnExit>
                <Stack spacing={1.1}>
                  <Grid container spacing={0.5}>
                    {AI_ITINVENT_TOOL_OPTIONS.map((tool) => (
                      <Grid item xs={12} md={6} key={tool.id}>
                        <FormControlLabel
                          control={(
                            <Checkbox
                              size="small"
                              checked={enabledTools.includes(tool.id)}
                              onChange={(event) => toggleTool(tool.id, event.target.checked)}
                            />
                          )}
                          label={tool.label}
                        />
                      </Grid>
                    ))}
                  </Grid>

                  <Grid container spacing={1.1}>
                    <Grid item xs={12} md={4}>
                      <FormControl fullWidth size="small">
                        <InputLabel id={`ai-bot-mode-${draft.slug || 'new'}`}>DB mode</InputLabel>
                        <Select
                          labelId={`ai-bot-mode-${draft.slug || 'new'}`}
                          label="DB mode"
                          value={draft.multi_db_mode || 'single'}
                          onChange={(event) => onChange('multi_db_mode', String(event.target.value || 'single'))}
                        >
                          <MenuItem value="single">Single DB</MenuItem>
                          <MenuItem value="admin_multi_db">Admin multi-DB</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={8}>
                      <FormControl fullWidth size="small" disabled={draft.multi_db_mode !== 'admin_multi_db'}>
                        <InputLabel id={`ai-bot-allowed-dbs-${draft.slug || 'new'}`}>Allowed databases</InputLabel>
                        <Select
                          multiple
                          labelId={`ai-bot-allowed-dbs-${draft.slug || 'new'}`}
                          label="Allowed databases"
                          value={allowedDatabases}
                          onChange={(event) => {
                            const rawValue = event.target.value;
                            const nextValue = Array.isArray(rawValue)
                              ? rawValue
                              : String(rawValue || '').split(',').map((item) => item.trim()).filter(Boolean);
                            onChange('allowed_databases', nextValue);
                          }}
                          renderValue={(selected) => (Array.isArray(selected) ? selected.join(', ') : '')}
                        >
                          {(Array.isArray(dbOptions) ? dbOptions : []).map((item) => (
                            <MenuItem key={item.id} value={item.id}>
                              <Checkbox size="small" checked={allowedDatabases.includes(item.id)} />
                              <Typography variant="body2">{item.name || item.id}</Typography>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  </Grid>
                </Stack>
              </Collapse>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    );
  };

  return (
    <Paper elevation={0} sx={{ ...getOfficePanelSx(ui, { boxShadow: 'none' }), p: 2.2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.2} sx={{ mb: 1.6 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>AI Bots</Typography>
          <Typography variant="body2" color="text.secondary">
            OpenRouter: {openrouterConfigured ? 'configured' : 'not configured'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
            PM2: `itinvent-ai-chat-worker` • health-check: `scripts/pm2/health-check.ps1`
          </Typography>
        </Box>
        <Button startIcon={<RefreshOutlinedIcon />} onClick={onRefresh} disabled={loading}>
          Обновить
        </Button>
      </Stack>

      <Alert severity={openrouterConfigured ? 'success' : 'warning'} sx={{ mb: 2 }}>
        {openrouterConfigured
          ? 'OpenRouter доступен. Боты смогут отвечать в chat AI-диалогах.'
          : 'OpenRouter не настроен. Проверьте OPENROUTER_API_KEY / OPENROUTER_BASE_URL.'}
      </Alert>

      <Alert severity="info" sx={{ mb: 2 }}>
        Live ITinvent access is configured only here in Settings / AI Bots. Users with `chat.ai.use` can open AI chats, but only admin or `settings.ai.manage` can enable live tools.
      </Alert>

      {loading && (!Array.isArray(bots) || bots.length === 0) ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Loading AI bots…</Typography>
        </Stack>
      ) : null}

      {!loading && Array.isArray(bots) && bots.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          AI bots not created yet. Create the first bot here, then open it from the chat sidebar.
        </Alert>
      ) : null}

      <Accordion disableGutters defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
          <Typography sx={{ fontWeight: 700 }}>Создать бота</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {renderBotFields(newDraft, (key, value) => setNewDraft((current) => ({ ...current, [key]: value })))}
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
            <Button
              variant="contained"
              startIcon={<AddOutlinedIcon />}
              onClick={() => onCreate({
                ...newDraft,
                allowed_kb_scope: String(newDraft.allowed_kb_scope || '').split(',').map((item) => item.trim()).filter(Boolean),
              })}
              disabled={savingBotId === 'new'}
            >
              Создать
            </Button>
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Stack spacing={1.2} sx={{ mt: 1.5 }}>
        {(Array.isArray(bots) ? bots : []).map((bot) => {
          const draft = draftsById[bot.id] || createAiBotDraft(bot);
          const runs = Array.isArray(runsByBotId?.[bot.id]) ? runsByBotId[bot.id] : [];
          const persistedEnabledTools = getAiBotEnabledTools(bot);
          const persistedLiveDataEnabled = isAiBotLiveDataEnabled(bot);
          const persistedLiveDataWarning = shouldWarnAiBotLiveDataDisabled(bot);
          return (
            <Accordion key={bot.id} disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', pr: 1 }}>
                  <Typography sx={{ flex: 1, fontWeight: 700 }}>{bot.title}</Typography>
                  <Chip size="small" label={bot.is_enabled ? 'enabled' : 'disabled'} color={bot.is_enabled ? 'success' : 'default'} />
                  <Chip size="small" label={persistedLiveDataEnabled ? 'live data on' : 'live data off'} color={persistedLiveDataEnabled ? 'info' : 'warning'} />
                  {bot.latest_run_status ? <Chip size="small" label={bot.latest_run_status} color={bot.latest_run_status === 'failed' ? 'error' : 'primary'} /> : null}
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                {renderBotFields(draft, (key, value) => updateDraft(bot.id, key, value))}
                {persistedLiveDataWarning ? (
                  <Alert severity="warning" sx={{ mt: 1.5 }}>
                    Persisted config is enabled but has no saved live ITinvent tools. Chat users will get plain LLM answers until this bot is saved with live data enabled.
                  </Alert>
                ) : null}
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1} sx={{ mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Bot user ID: {bot.bot_user_id || 'pending'} • Updated: {bot.updated_at || 'n/a'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Saved tools: {persistedEnabledTools.length} - DB mode: {bot?.tool_settings?.multi_db_mode || 'single'}
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<SaveOutlinedIcon />}
                    onClick={() => onSave(bot.id, {
                      ...draft,
                      allowed_kb_scope: String(draft.allowed_kb_scope || '').split(',').map((item) => item.trim()).filter(Boolean),
                    })}
                    disabled={savingBotId === bot.id}
                  >
                    Сохранить
                  </Button>
                </Stack>
                {runs.length > 0 ? (
                  <Box sx={{ mt: 1.4 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.8, fontWeight: 700 }}>Последние run</Typography>
                    <Stack spacing={0.8}>
                      {runs.slice(0, 5).map((run) => (
                        <Box key={run.id} sx={{ ...getOfficeSubtlePanelSx(ui), p: 1.2 }}>
                          <Typography variant="caption" sx={{ fontWeight: 700 }}>
                            {run.status} • {run.latency_ms ? `${run.latency_ms} ms` : '—'}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            DB: {run.effective_database_id || 'not resolved'} - tool traces: {run.tool_traces_count || 0}{run.tool_trace_errors_count ? ` - tool errors: ${run.tool_trace_errors_count}` : ''}
                          </Typography>
                          {run.status_text ? (
                            <Typography variant="body2" color="text.secondary">{run.status_text}</Typography>
                          ) : null}
                          {run.error_text ? (
                            <Typography variant="body2" color="error.main">{run.error_text}</Typography>
                          ) : null}
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ) : null}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Stack>
    </Paper>
  );
}

function Settings() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isDesktopViewport = useMediaQuery(DESKTOP_SCROLL_QUERY);
  const isVeryWide = useMediaQuery(SETTINGS_VERY_WIDE_QUERY);
  const pageRef = useRef(null);
  const viewportHeight = useViewportHeight(pageRef, isDesktopViewport);

  const { user, hasPermission, refreshSession, logout } = useAuth();
  const { preferences, savePreferences } = usePreferences();
  const {
    notifySuccess: pushNotifySuccess,
    notifyInfo: pushNotifyInfo,
    notifyApiError: pushNotifyApiError,
  } = useNotification();
  const settingsToastAction = useMemo(() => createNavigateToastAction('/settings', 'Открыть настройки'), []);
  const notifySuccess = useCallback((message, options = {}) => (
    pushNotifySuccess(message, { source: 'settings', action: settingsToastAction, ...options })
  ), [pushNotifySuccess, settingsToastAction]);
  const notifyInfo = useCallback((message, options = {}) => (
    pushNotifyInfo(message, { source: 'settings', action: settingsToastAction, ...options })
  ), [pushNotifyInfo, settingsToastAction]);
  const notifyApiError = useCallback((error, fallbackMessage, options = {}) => (
    pushNotifyApiError(error, fallbackMessage, { source: 'settings', action: settingsToastAction, ...options })
  ), [pushNotifyApiError, settingsToastAction]);

  const isAdmin = String(user?.role || '').trim() === 'admin';
  const canManageUsers = isAdmin || hasPermission('settings.users.manage');
  const canManageSessions = isAdmin || hasPermission('settings.sessions.manage');
  const canManageAiBots = isAdmin || hasPermission('settings.ai.manage');

  const availableTabs = useMemo(
    () => resolveAvailableSettingsTabs({ hasPermission, isAdmin }),
    [hasPermission, isAdmin],
  );

  const [tab, setTab] = useState('profile');
  const [blockingError, setBlockingError] = useState('');
  const [themeMode, setThemeMode] = useState(preferences.theme_mode || 'light');
  const [fontFamily, setFontFamily] = useState(preferences.font_family || 'Inter');
  const [fontScale, setFontScale] = useState(Number(preferences.font_scale || 1));
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [databases, setDatabases] = useState([]);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [databasesLoaded, setDatabasesLoaded] = useState(false);
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [syncingAD, setSyncingAD] = useState(false);
  const [cleanupResult, setCleanupResult] = useState({ deactivated: 0, deleted: 0 });
  const [cleaningSessions, setCleaningSessions] = useState(false);
  const [purgingSessions, setPurgingSessions] = useState(false);
  const [envState, setEnvState] = useState({ items: [], deployment_targets: [], apply_plan: [], recent_changes: [], updated: 0 });
  const [envLoading, setEnvLoading] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [aiBotsState, setAiBotsState] = useState([]);
  const [aiBotsLoading, setAiBotsLoading] = useState(false);
  const [savingAiBotId, setSavingAiBotId] = useState('');
  const [aiBotRunsById, setAiBotRunsById] = useState({});
  const [appSettingsState, setAppSettingsState] = useState(() => normalizeAppSettingsState(null));
  const [appSettingsLoading, setAppSettingsLoading] = useState(false);
  const [savingAppSettings, setSavingAppSettings] = useState(false);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [resettingTwoFactor, setResettingTwoFactor] = useState(false);
  const [trustedDevices, setTrustedDevices] = useState([]);
  const [backupCodes, setBackupCodes] = useState([]);
  const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);

  useEffect(() => {
    setThemeMode(preferences.theme_mode || 'light');
    setFontFamily(preferences.font_family || 'Inter');
    setFontScale(Number(preferences.font_scale || 1));
  }, [preferences]);

  useEffect(() => {
    if (!availableTabs.some((item) => item.value === tab)) {
      setTab(availableTabs[0]?.value || 'profile');
    }
  }, [availableTabs, tab]);

  const dbOptions = useMemo(
    () => databases.map((db) => ({ id: String(db.id), name: db.name })),
    [databases],
  );

  const loadDatabases = useCallback(async () => {
    setDatabasesLoading(true);
    try {
      const data = await databaseAPI.getAvailableDatabases();
      setDatabases(Array.isArray(data) ? data : []);
      setDatabasesLoaded(true);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setDatabasesLoaded(false);
      setBlockingError('Не удалось загрузить список баз данных.');
    } finally {
      setDatabasesLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    if (!canManageUsers) return;
    setUsersLoading(true);
    try {
      const data = await authAPI.getUsers();
      const baseUsers = (Array.isArray(data) ? data : []).map((item) => ({
        ...item,
        use_custom_permissions: Boolean(item?.use_custom_permissions),
        custom_permissions: normalizePermissions(item?.custom_permissions),
      }));
      const usersWithDelegates = await Promise.all(
        baseUsers.map(async (item) => {
          try {
            const delegates = await authAPI.getTaskDelegates(item.id);
            return {
              ...item,
              task_delegate_links: normalizeTaskDelegateLinks(delegates),
            };
          } catch {
            return {
              ...item,
              task_delegate_links: [],
            };
          }
        }),
      );
      setUsers(usersWithDelegates);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить пользователей.');
    } finally {
      setUsersLoading(false);
    }
  }, [canManageUsers]);

  const loadSessions = useCallback(async () => {
    if (!canManageSessions) return;
    setSessionsLoading(true);
    try {
      const data = await authAPI.getSessions();
      setSessions(Array.isArray(data) ? data : []);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить сессии.');
    } finally {
      setSessionsLoading(false);
    }
  }, [canManageSessions]);

  const loadEnv = useCallback(async () => {
    if (!isAdmin) return;
    setEnvLoading(true);
    try {
      const data = await settingsAPI.getEnvSettings();
      setEnvState({
        items: Array.isArray(data?.items) ? data.items : [],
        deployment_targets: Array.isArray(data?.deployment_targets) ? data.deployment_targets : [],
        apply_plan: Array.isArray(data?.apply_plan) ? data.apply_plan : [],
        recent_changes: Array.isArray(data?.recent_changes) ? data.recent_changes : [],
        updated: Number(data?.updated || 0),
      });
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить переменные окружения.');
    } finally {
      setEnvLoading(false);
    }
  }, [isAdmin]);

  const loadAppSettings = useCallback(async () => {
    if (!isAdmin) return;
    setAppSettingsLoading(true);
    try {
      const data = await settingsAPI.getAppSettings();
      setAppSettingsState(normalizeAppSettingsState(data));
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить web-настройки reminder-задач.');
    } finally {
      setAppSettingsLoading(false);
    }
  }, [isAdmin]);

  const loadAiBotsAdmin = useCallback(async () => {
    if (!canManageAiBots) return;
    setAiBotsLoading(true);
    try {
      const data = await settingsAPI.getAiBots();
      const items = Array.isArray(data) ? data : [];
      setAiBotsState(items);
      const runsEntries = await Promise.all(
        items.map(async (item) => {
          try {
            const runsResponse = await settingsAPI.getAiBotRuns(item.id);
            return [item.id, Array.isArray(runsResponse?.items) ? runsResponse.items : []];
          } catch {
            return [item.id, []];
          }
        }),
      );
      setAiBotRunsById(Object.fromEntries(runsEntries));
      setBlockingError('');
      return items;
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить настройки AI-ботов.');
      return [];
    } finally {
      setAiBotsLoading(false);
    }
  }, [canManageAiBots]);

  const loadSecurity = useCallback(async () => {
    if (!user?.id) return;
    setSecurityLoading(true);
    try {
      const devices = await authAPI.getTrustedDevices();
      setTrustedDevices(Array.isArray(devices) ? devices : []);
      setBlockingError('');
    } catch (error) {
      console.error(error);
      setBlockingError('Не удалось загрузить данные по безопасности входа.');
    } finally {
      setSecurityLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const needsDatabases = tab === 'profile' || (tab === 'users' && canManageUsers) || (tab === 'ai-bots' && canManageAiBots);
    if (user && needsDatabases && !databasesLoaded && !databasesLoading) {
      loadDatabases();
    }
  }, [canManageAiBots, canManageUsers, databasesLoaded, databasesLoading, loadDatabases, tab, user]);

  useEffect(() => {
    setBlockingError('');
    if (tab === 'security') {
      loadSecurity();
    }
    if (tab === 'users' && canManageUsers) {
      loadUsers();
      if (canManageSessions) loadSessions();
    }
    if (tab === 'sessions' && canManageSessions) {
      loadSessions();
    }
    if (tab === 'env' && isAdmin) {
      loadEnv();
      loadAppSettings();
    }
    if (tab === 'ai-bots' && canManageAiBots) {
      loadAiBotsAdmin();
    }
  }, [tab, canManageUsers, canManageSessions, canManageAiBots, isAdmin, loadUsers, loadSessions, loadEnv, loadAppSettings, loadAiBotsAdmin, loadSecurity]);

  const handleSavePreferences = useCallback(async () => {
    setSavingPreferences(true);
    setBlockingError('');
    try {
      await savePreferences({
        theme_mode: themeMode,
        font_family: fontFamily,
        font_scale: Number(fontScale),
      });
      notifySuccess('Настройки внешнего вида сохранены.', { source: 'settings', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить настройки внешнего вида.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingPreferences(false);
    }
  }, [fontFamily, fontScale, notifyApiError, notifySuccess, savePreferences, themeMode]);

  const handleRegenerateBackupCodes = useCallback(async () => {
    try {
      const response = await authAPI.regenerateBackupCodes();
      setBackupCodes(Array.isArray(response?.backup_codes) ? response.backup_codes : []);
      setBackupCodesDialogOpen(true);
      notifySuccess('Новые backup-коды сгенерированы. Сохраните их в безопасном месте.', { dedupeMode: 'none' });
      await loadSecurity();
    } catch (error) {
      notifyApiError(error, 'Не удалось сгенерировать backup-коды.', { dedupeMode: 'none' });
    }
  }, [loadSecurity, notifyApiError, notifySuccess]);

  const handleRevokeTrustedDevice = useCallback(async (deviceId) => {
    try {
      await authAPI.revokeTrustedDevice(deviceId);
      await refreshSession({ suppressAuthRequired: true });
      notifySuccess('Доверенное устройство отозвано.', { dedupeMode: 'none' });
      await loadSecurity();
    } catch (error) {
      notifyApiError(error, 'Не удалось отозвать доверенное устройство.', { dedupeMode: 'none' });
    }
  }, [loadSecurity, notifyApiError, notifySuccess, refreshSession]);

  const handleReloadSecurity = useCallback(async () => {
    try {
      await refreshSession({ suppressAuthRequired: true });
    } catch (error) {
      console.error(error);
    }
    await loadSecurity();
  }, [loadSecurity, refreshSession]);

  const handleResetTwoFactor = useCallback(async () => {
    if (!user?.id) return;
    const confirmed = window.confirm(
      'Сбросить 2FA и удалить все доверенные устройства для этой учётной записи? После этого нужно будет войти заново и настроить код повторно.'
    );
    if (!confirmed) return;
    setResettingTwoFactor(true);
    try {
      await authAPI.resetOwnTwoFactor();
      notifySuccess('2FA и доверенные устройства сброшены. Войдите заново и настройте код повторно.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      await logout();
      window.location.assign('/login');
    } catch (error) {
      notifyApiError(error, 'Не удалось сбросить 2FA для текущей учётной записи.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setResettingTwoFactor(false);
    }
  }, [logout, notifyApiError, notifySuccess, user?.id]);

  const handleCreateUser = useCallback(async (draft) => {
    setSavingUser(true);
    try {
      const payload = {
        username: draft.username,
        password: draft.auth_source === 'ldap' ? null : (String(draft.password || '').trim() || null),
        full_name: draft.full_name || null,
        department: draft.department || null,
        job_title: draft.job_title || null,
        email: draft.email || null,
        mailbox_email: draft.mailbox_email || null,
        mailbox_login: draft.mailbox_login || null,
        role: draft.role || 'viewer',
        auth_source: draft.auth_source || 'local',
        telegram_id: draft.telegram_id ? Number(draft.telegram_id) : null,
        assigned_database: draft.assigned_database || null,
        is_active: Boolean(draft.is_active),
        use_custom_permissions: Boolean(draft.use_custom_permissions),
        custom_permissions: normalizePermissions(draft.custom_permissions),
      };
      if (payload.auth_source !== 'ldap' && String(payload.password || '').length < 6) {
        notifyInfo('Для локального пользователя нужен пароль не короче 6 символов.', {
          source: 'settings',
          dedupeMode: 'none',
        });
        return { ok: false };
      }
      const created = await authAPI.createUser(payload);
      if (Array.isArray(draft.task_delegate_links) && draft.task_delegate_links.length > 0) {
        await authAPI.updateTaskDelegates(
          created.id,
          normalizeTaskDelegateLinks(draft.task_delegate_links).map((item) => ({
            delegate_user_id: Number(item.delegate_user_id),
            role_type: item.role_type === 'deputy' ? 'deputy' : 'assistant',
            is_active: item.is_active !== false,
          })),
        );
      }
      await loadUsers();
      notifySuccess(`Пользователь ${created.username} создан.`, { source: 'settings', dedupeMode: 'none' });
      return { ok: true, user: created };
    } catch (error) {
      notifyApiError(error, 'Не удалось создать пользователя.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return { ok: false };
    } finally {
      setSavingUser(false);
    }
  }, [loadUsers, notifyApiError, notifySuccess]);

  const handleUpdateUser = useCallback(async (draft) => {
    setSavingUser(true);
    try {
      const userId = Number(draft.id);
      if (!Number.isFinite(userId) || userId <= 0) {
        notifyInfo('Неизвестный пользователь для сохранения.', { source: 'settings', dedupeMode: 'none' });
        return { ok: false };
      }

      const payload = {
        full_name: draft.full_name || null,
        department: draft.department || null,
        job_title: draft.job_title || null,
        email: draft.email || null,
        mailbox_email: draft.mailbox_email || null,
        mailbox_login: draft.mailbox_login || null,
        role: draft.role || 'viewer',
        auth_source: draft.auth_source || 'local',
        telegram_id: draft.telegram_id ? Number(draft.telegram_id) : null,
        assigned_database: draft.assigned_database || null,
        is_active: Boolean(draft.is_active),
        use_custom_permissions: Boolean(draft.use_custom_permissions),
        custom_permissions: normalizePermissions(draft.custom_permissions),
      };
      const updated = await authAPI.updateUser(userId, payload);
      await authAPI.updateTaskDelegates(
        userId,
        normalizeTaskDelegateLinks(draft.task_delegate_links).map((item) => ({
          delegate_user_id: Number(item.delegate_user_id),
          role_type: item.role_type === 'deputy' ? 'deputy' : 'assistant',
          is_active: item.is_active !== false,
        })),
      );
      await loadUsers();
      if (canManageSessions) await loadSessions();
      if (Number(userId) === Number(user?.id)) {
        await refreshSession();
      }
      notifySuccess(`Пользователь ${updated.username} обновлён.`, { source: 'settings', dedupeMode: 'none' });
      return { ok: true, user: updated };
    } catch (error) {
      if (error?.response?.status === 404) {
        await loadUsers();
        if (canManageSessions) await loadSessions();
        notifyInfo('Пользователь больше не найден. Список обновлён.', {
          source: 'settings',
          dedupeMode: 'none',
        });
        return { ok: false, reason: 'not_found' };
      }
      notifyApiError(error, 'Не удалось обновить пользователя.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return { ok: false };
    } finally {
      setSavingUser(false);
    }
  }, [canManageSessions, loadSessions, loadUsers, notifyApiError, notifyInfo, notifySuccess, refreshSession, user?.id]);

  const handleDeleteUser = useCallback(async (target) => {
    try {
      await authAPI.deleteUser(target.id);
      await loadUsers();
      if (canManageSessions) await loadSessions();
      notifySuccess(`Пользователь ${target.username} удалён.`, { source: 'settings', dedupeMode: 'none' });
      return { ok: true };
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить пользователя.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return { ok: false };
    }
  }, [canManageSessions, loadSessions, loadUsers, notifyApiError, notifySuccess]);

  const handleSyncAD = useCallback(async () => {
    setSyncingAD(true);
    try {
      const result = await authAPI.syncAD();
      const summary = Object.values(result?.results || {}).reduce((acc, item) => ({
        added: acc.added + Number(item?.added || 0),
        updated: acc.updated + Number(item?.updated || 0),
      }), { added: 0, updated: 0 });
      await loadUsers();
      notifySuccess(`Синхронизация AD завершена. Новых: ${summary.added}, обновлено: ${summary.updated}.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось выполнить синхронизацию с AD.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSyncingAD(false);
    }
  }, [loadUsers, notifyApiError, notifySuccess]);

  const handleTerminateSession = useCallback(async (sessionId) => {
    try {
      await authAPI.terminateSession(sessionId);
      await loadSessions();
      if (canManageUsers) await loadUsers();
      notifySuccess('Сессия завершена.', { source: 'settings', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось завершить сессию.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    }
  }, [canManageUsers, loadSessions, loadUsers, notifyApiError, notifySuccess]);

  const handleCleanupSessions = useCallback(async () => {
    setCleaningSessions(true);
    try {
      const result = await authAPI.cleanupSessions();
      setCleanupResult({
        deactivated: Number(result?.deactivated || 0),
        deleted: Number(result?.deleted || 0),
      });
      await loadSessions();
      notifySuccess(`Cleanup выполнен. Деактивировано: ${result?.deactivated || 0}, удалено: ${result?.deleted || 0}.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось выполнить cleanup сессий.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setCleaningSessions(false);
    }
  }, [loadSessions, notifyApiError, notifySuccess]);

  const handlePurgeInactiveSessions = useCallback(async () => {
    setPurgingSessions(true);
    try {
      const result = await authAPI.purgeInactiveSessions();
      setCleanupResult({
        deactivated: Number(result?.deactivated || 0),
        deleted: Number(result?.deleted || 0),
      });
      await loadSessions();
      if (canManageUsers) await loadUsers();
      notifySuccess(`Неактивные сессии удалены. Удалено: ${result?.deleted || 0}.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить неактивные сессии.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setPurgingSessions(false);
    }
  }, [canManageUsers, loadSessions, loadUsers, notifyApiError, notifySuccess]);

  const handleSaveEnv = useCallback(async (draftValues) => {
    const sourceItems = Array.isArray(envState?.items) ? envState.items : [];
    const changedItems = sourceItems
      .filter((item) => (draftValues[item.key] ?? '') !== (item.value ?? ''))
      .reduce((acc, item) => {
        acc[item.key] = draftValues[item.key] ?? '';
        return acc;
      }, {});

    if (Object.keys(changedItems).length === 0) {
      notifyInfo('Изменений в .env нет.', { source: 'settings', dedupeMode: 'none' });
      return;
    }

    setSavingEnv(true);
    try {
      const result = await settingsAPI.updateEnvSettings(changedItems);
      setEnvState({
        items: Array.isArray(result?.items) ? result.items : [],
        deployment_targets: Array.isArray(result?.deployment_targets) ? result.deployment_targets : [],
        apply_plan: Array.isArray(result?.apply_plan) ? result.apply_plan : [],
        recent_changes: Array.isArray(result?.recent_changes) ? result.recent_changes : [],
        updated: Number(result?.updated || 0),
      });
      notifySuccess(`Переменные окружения сохранены. Изменено: ${result?.updated || 0}.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить переменные окружения.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingEnv(false);
    }
  }, [envState?.items, notifyApiError, notifyInfo, notifySuccess]);

  const handleSaveAppSettings = useCallback(async (patch) => {
    setSavingAppSettings(true);
    try {
      const result = await settingsAPI.updateAppSettings(patch);
      setAppSettingsState(normalizeAppSettingsState(result));
      notifySuccess('Контролёр по умолчанию для reminder-задач сохранён.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить контролёра по умолчанию для reminder-задач.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingAppSettings(false);
    }
  }, [notifyApiError, notifySuccess]);

  const handleCreateAiBot = useCallback(async (draft) => {
    setSavingAiBotId('new');
    try {
      const created = await settingsAPI.createAiBot({
        ...draft,
        slug: String(draft?.slug || '').trim().toLowerCase(),
        title: String(draft?.title || '').trim(),
        description: String(draft?.description || '').trim(),
        system_prompt: String(draft?.system_prompt || '').trim(),
        model: String(draft?.model || '').trim(),
        temperature: Number(draft?.temperature ?? 0.2),
        max_tokens: Number(draft?.max_tokens ?? 2000),
        allowed_kb_scope: Array.isArray(draft?.allowed_kb_scope) ? draft.allowed_kb_scope : [],
        enabled_tools: Array.isArray(draft?.enabled_tools) ? draft.enabled_tools : [],
        tool_settings: {
          multi_db_mode: String(draft?.multi_db_mode || 'single').trim() || 'single',
          allowed_databases: Array.isArray(draft?.allowed_databases) ? draft.allowed_databases : [],
        },
      });
      await loadAiBotsAdmin();
      notifySuccess(`AI-бот ${created?.title || created?.slug || 'bot'} создан.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать AI-бота.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingAiBotId('');
    }
  }, [loadAiBotsAdmin, notifyApiError, notifySuccess]);

  const handleUpdateAiBot = useCallback(async (botId, draft) => {
    const normalizedBotId = String(botId || '').trim();
    if (!normalizedBotId) return;
    setSavingAiBotId(normalizedBotId);
    try {
      const updated = await settingsAPI.updateAiBot(normalizedBotId, {
        ...draft,
        title: String(draft?.title || '').trim(),
        description: String(draft?.description || '').trim(),
        system_prompt: String(draft?.system_prompt || '').trim(),
        model: String(draft?.model || '').trim(),
        temperature: Number(draft?.temperature ?? 0.2),
        max_tokens: Number(draft?.max_tokens ?? 2000),
        allowed_kb_scope: Array.isArray(draft?.allowed_kb_scope) ? draft.allowed_kb_scope : [],
        enabled_tools: Array.isArray(draft?.enabled_tools) ? draft.enabled_tools : [],
        tool_settings: {
          multi_db_mode: String(draft?.multi_db_mode || 'single').trim() || 'single',
          allowed_databases: Array.isArray(draft?.allowed_databases) ? draft.allowed_databases : [],
        },
      });
      await loadAiBotsAdmin();
      notifySuccess(`AI-бот ${updated?.title || updated?.slug || 'bot'} обновлён.`, {
        source: 'settings',
        dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить AI-бота.', {
        source: 'settings',
        dedupeMode: 'none',
      });
    } finally {
      setSavingAiBotId('');
    }
  }, [loadAiBotsAdmin, notifyApiError, notifySuccess]);

  return (
    <MainLayout>
      <PageShell
        ref={pageRef}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.1,
          minHeight: 0,
          height: isDesktopViewport && viewportHeight ? `${viewportHeight}px` : 'auto',
          overflow: { xs: 'visible', md: 'hidden' },
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            ...getOfficePanelSx(ui, {
              p: { xs: 0.95, md: 1.05 },
              borderRadius: '12px',
              backgroundColor: ui.panelSolid,
              boxShadow: 'none',
            }),
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" sx={{ color: 'primary.main', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.05, fontSize: '0.66rem' }}>
            Администрирование / Настройки
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 900, mt: 0.1, lineHeight: 1.02, fontSize: { xs: '1.75rem', md: '2rem' } }}>
            Настройки
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.15, maxWidth: 640, fontSize: '0.84rem', lineHeight: 1.35 }}>
            Профиль, внешний вид, пользователи, сессии и переменные окружения в одной служебной зоне.
          </Typography>
        </Paper>

        {blockingError ? (
          <Alert severity="error" onClose={() => setBlockingError('')} sx={{ flexShrink: 0 }}>
            {blockingError}
          </Alert>
        ) : null}

        <Paper
          variant="outlined"
          sx={{
            ...getOfficePanelSx(ui, {
              borderRadius: '12px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              flex: 1,
              boxShadow: 'none',
            }),
          }}
        >
          <Tabs
            value={tab}
            onChange={(_, nextValue) => setTab(nextValue)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: 1, borderColor: ui.headerBandBorder, px: 0.85, minHeight: 36, flexShrink: 0 }}
          >
            {availableTabs.map((item) => (
              <Tab
                key={item.value}
                value={item.value}
                icon={item.icon}
                iconPosition="start"
                label={item.label}
                sx={{ minHeight: 36, py: 0.2, px: 1.05, fontSize: '0.83rem' }}
              />
            ))}
          </Tabs>

          <Box
            sx={{
              p: { xs: 1, md: 1.2 },
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              flex: 1,
              overflow: { xs: 'visible', md: 'hidden' },
            }}
          >
            <SettingsTabPanel active={tab === 'profile'}>
              <Box sx={{ overflowY: { xs: 'visible', md: 'auto' }, minHeight: 0, pr: { md: 0.5 } }}>
                <ProfileTab user={user} dbOptions={dbOptions} />
              </Box>
            </SettingsTabPanel>

            <SettingsTabPanel active={tab === 'security'}>
              <Box sx={{ overflowY: { xs: 'visible', md: 'auto' }, minHeight: 0, pr: { md: 0.5 } }}>
                <SecurityTab
                  user={user}
                  trustedDevices={trustedDevices}
                  loading={securityLoading}
                  resettingTwoFactor={resettingTwoFactor}
                  onReload={handleReloadSecurity}
                  onRegenerateBackupCodes={handleRegenerateBackupCodes}
                  onRevokeTrustedDevice={handleRevokeTrustedDevice}
                  onResetTwoFactor={handleResetTwoFactor}
                />
              </Box>
            </SettingsTabPanel>

            <SettingsTabPanel active={tab === 'appearance'}>
              <Box sx={{ overflowY: { xs: 'visible', md: 'auto' }, minHeight: 0, pr: { md: 0.5 } }}>
                <AppearanceTab
                  themeMode={themeMode}
                  setThemeMode={setThemeMode}
                  fontFamily={fontFamily}
                  setFontFamily={setFontFamily}
                  fontScale={fontScale}
                  setFontScale={setFontScale}
                  handleSavePreferences={handleSavePreferences}
                  saving={savingPreferences}
                />
              </Box>
            </SettingsTabPanel>

            <SettingsTabPanel active={tab === 'users' && canManageUsers}>
              <UsersTab
                currentUserId={user?.id}
                users={users}
                sessions={sessions}
                dbOptions={dbOptions}
                loading={usersLoading}
                syncingAD={syncingAD}
                savingUser={savingUser}
                onSyncAD={handleSyncAD}
                onCreateUser={handleCreateUser}
                onUpdateUser={handleUpdateUser}
                onDeleteUser={handleDeleteUser}
                isVeryWide={isVeryWide}
              />
            </SettingsTabPanel>

            <SettingsTabPanel active={tab === 'sessions' && canManageSessions}>
              <SessionsTab
                sessions={sessions}
                loading={sessionsLoading}
                cleanupResult={cleanupResult}
                cleaning={cleaningSessions}
                purging={purgingSessions}
                onCleanup={handleCleanupSessions}
                onPurge={handlePurgeInactiveSessions}
                onTerminate={handleTerminateSession}
              />
            </SettingsTabPanel>

            <SettingsTabPanel active={tab === 'ai-bots' && canManageAiBots}>
              <Box sx={{ overflowY: { xs: 'visible', md: 'auto' }, minHeight: 0, pr: { md: 0.5 } }}>
                <AiBotsAdminSection
                  bots={aiBotsState}
                  loading={aiBotsLoading}
                  savingBotId={savingAiBotId}
                  runsByBotId={aiBotRunsById}
                  onRefresh={loadAiBotsAdmin}
                  onCreate={handleCreateAiBot}
                  onSave={handleUpdateAiBot}
                  openrouterConfigured={Boolean(aiBotsState.some((item) => item?.openrouter_configured || item?.configured))}
                  dbOptions={dbOptions}
                />
              </Box>
            </SettingsTabPanel>

            <SettingsTabPanel active={tab === 'env' && isAdmin}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
                <AdminLoginAllowlistSettingsCard
                  appSettings={appSettingsState}
                  loading={appSettingsLoading}
                  saving={savingAppSettings}
                  onSave={handleSaveAppSettings}
                />
                <TransferActReminderSettingsCard
                  appSettings={appSettingsState}
                  loading={appSettingsLoading}
                  saving={savingAppSettings}
                  onSave={handleSaveAppSettings}
                />
                <EnvVariablesTab
                  envState={envState}
                  loading={envLoading}
                  saving={savingEnv}
                  onRefresh={loadEnv}
                  onSave={handleSaveEnv}
                />
              </Box>
            </SettingsTabPanel>
          </Box>
        </Paper>

        <Dialog open={backupCodesDialogOpen} onClose={() => setBackupCodesDialogOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>Backup-коды 2FA</DialogTitle>
          <DialogContent dividers>
            <Alert severity="warning" sx={{ mb: 2 }}>
              Сохраните эти коды в безопасном месте. Каждый код одноразовый.
            </Alert>
            <Stack spacing={0.75}>
              {backupCodes.map((item) => (
                <Typography key={item} sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                  {item}
                </Typography>
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={() => setBackupCodesDialogOpen(false)}>
              Закрыть
            </Button>
          </DialogActions>
        </Dialog>
      </PageShell>
    </MainLayout>
  );
}

export default Settings;
