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
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import apiClient, { authAPI, settingsAPI } from '../api/client';
import OverflowMenu from '../components/common/OverflowMenu';
import { useAuth } from '../contexts/AuthContext';
import { usePreferences } from '../contexts/PreferencesContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  buildOfficeUiTokens,
  getOfficeHeaderBandSx,
  getOfficeMetricBlockSx,
  getOfficePanelSx,
  getOfficeSubtlePanelSx,
} from '../theme/officeUiTokens';

const SETTINGS_TABS = [
  { value: 'profile', label: 'Профиль', icon: <PersonOutlineIcon fontSize="small" /> },
  { value: 'appearance', label: 'Внешний вид', icon: <PaletteOutlinedIcon fontSize="small" /> },
  { value: 'users', label: 'Пользователи', icon: <GroupOutlinedIcon fontSize="small" />, permission: 'settings.users.manage' },
  { value: 'sessions', label: 'Сессии', icon: <SecurityOutlinedIcon fontSize="small" />, permission: 'settings.sessions.manage' },
  { value: 'env', label: 'Переменные', icon: <SettingsApplicationsOutlinedIcon fontSize="small" />, adminOnly: true },
];

const SETTINGS_VERY_WIDE_QUERY = '(min-width:1920px)';
const ENV_HELP_WIDE_QUERY = '(min-width:1536px)';
const DESKTOP_SCROLL_QUERY = '(min-width:900px)';
const USER_ROWS_PER_PAGE_OPTIONS = [10, 25, 50];
const DEFAULT_USER_ROWS_PER_PAGE = 25;

const roleOptions = [
  { value: 'admin', label: 'Админ', color: 'error' },
  { value: 'operator', label: 'Оператор', color: 'primary' },
  { value: 'viewer', label: 'Просмотр', color: 'default' },
];

const permissionGroups = [
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

function createEmptyUserDraft() {
  return {
    id: null,
    username: '',
    password: '',
    full_name: '',
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
  };
}

function createUserDraftFromItem(item) {
  if (!item) return createEmptyUserDraft();
  return {
    id: item.id,
    username: item.username || '',
    password: '',
    full_name: item.full_name || '',
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
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
    mail_updated_at: item.mail_updated_at || null,
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
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0 }}>
      <SectionCard title="Профиль" description="Основные сведения об учётной записи." contentSx={{ p: 1.5 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}><ProfileField label="Логин" value={user?.username} /></Grid>
          <Grid item xs={12} md={6}><ProfileField label="Полное имя" value={user?.full_name} /></Grid>
          <Grid item xs={12} md={6}><ProfileField label="Email" value={user?.email} /></Grid>
          <Grid item xs={12} md={6}><ProfileField label="Telegram ID" value={user?.telegram_id ? String(user.telegram_id) : 'не указан'} /></Grid>
        </Grid>
      </SectionCard>

      <SectionCard title="Интеграции и доступ" description="Источник входа, права и почтовой профиль." contentSx={{ p: 1.5 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><ProfileField label="Роль" value={roleOptions.find((item) => item.value === user?.role)?.label || user?.role} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Источник входа" value={user?.auth_source === 'ldap' ? 'AD / LDAP' : 'Локальная'} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Назначенная БД" value={getDbName(dbOptions, user?.assigned_database)} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Почта Exchange" value={user?.mailbox_email || 'Не настроена'} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Логин Exchange" value={user?.mailbox_login || 'Не указан'} /></Grid>
          <Grid item xs={12} md={4}><ProfileField label="Права" value={summarizePermissions(user)} /></Grid>
        </Grid>
      </SectionCard>
    </Box>
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
    </Grid>
  );
}

function UserDraftFields({ draft, onChange, dbOptions, linkedSessions }) {
  const togglePermission = useCallback((permission) => {
    const current = normalizePermissions(draft.custom_permissions);
    if (current.includes(permission)) {
      onChange('custom_permissions', current.filter((item) => item !== permission));
      return;
    }
    onChange('custom_permissions', [...current, permission]);
  }, [draft.custom_permissions, onChange]);

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
            {permissionGroups.map((group) => (
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
            <TextField fullWidth size="small" label="Логин Exchange" value={draft.mailbox_login} onChange={(event) => onChange('mailbox_login', event.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              type="password"
              label="Новый пароль Exchange"
              helperText="Оставьте пустым, если менять пароль не нужно."
              value={draft.mailbox_password}
              onChange={(event) => onChange('mailbox_password', event.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" color="text.secondary">
              Почта обновлена: {formatDateTime(draft.mail_updated_at)}
            </Typography>
          </Grid>
        </Grid>
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
      email: String(draft.email || '').trim(),
      mailbox_email: String(draft.mailbox_email || '').trim(),
      mailbox_login: String(draft.mailbox_login || '').trim(),
      mailbox_password: String(draft.mailbox_password || ''),
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
            {item.mailbox_login || item.email || 'Логин не задан'}
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
        <UserDraftFields draft={draft} onChange={handleDraftChange} dbOptions={dbOptions} linkedSessions={linkedSessions} />
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
                  Показаны только отфильтрованные записи. Поиск работает по логину, имени, email и Telegram ID.
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

function Settings() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isDesktopViewport = useMediaQuery(DESKTOP_SCROLL_QUERY);
  const isVeryWide = useMediaQuery(SETTINGS_VERY_WIDE_QUERY);
  const pageRef = useRef(null);
  const viewportHeight = useViewportHeight(pageRef, isDesktopViewport);

  const { user, hasPermission, refreshSession } = useAuth();
  const { preferences, savePreferences } = usePreferences();
  const { notifySuccess, notifyInfo, notifyApiError } = useNotification();

  const canManageUsers = hasPermission('settings.users.manage');
  const canManageSessions = hasPermission('settings.sessions.manage');
  const isAdmin = String(user?.role || '').trim() === 'admin';

  const availableTabs = useMemo(() => SETTINGS_TABS.filter((item) => {
    if (item.adminOnly) return isAdmin;
    if (!item.permission) return true;
    return hasPermission(item.permission);
  }), [hasPermission, isAdmin]);

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
      const response = await apiClient.get('/database/list');
      setDatabases(Array.isArray(response?.data) ? response.data : []);
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
      setUsers((Array.isArray(data) ? data : []).map((item) => ({
        ...item,
        use_custom_permissions: Boolean(item?.use_custom_permissions),
        custom_permissions: normalizePermissions(item?.custom_permissions),
      })));
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

  useEffect(() => {
    const needsDatabases = tab === 'profile' || (tab === 'users' && canManageUsers);
    if (user && needsDatabases && !databasesLoaded && !databasesLoading) {
      loadDatabases();
    }
  }, [canManageUsers, databasesLoaded, databasesLoading, loadDatabases, tab, user]);

  useEffect(() => {
    setBlockingError('');
    if (tab === 'users' && canManageUsers) {
      loadUsers();
      if (canManageSessions) loadSessions();
    }
    if (tab === 'sessions' && canManageSessions) {
      loadSessions();
    }
    if (tab === 'env' && isAdmin) {
      loadEnv();
    }
  }, [tab, canManageUsers, canManageSessions, isAdmin, loadUsers, loadSessions, loadEnv]);

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

  const handleCreateUser = useCallback(async (draft) => {
    setSavingUser(true);
    try {
      const payload = {
        username: draft.username,
        password: draft.auth_source === 'ldap' ? null : (String(draft.password || '').trim() || null),
        full_name: draft.full_name || null,
        email: draft.email || null,
        mailbox_email: draft.mailbox_email || null,
        mailbox_login: draft.mailbox_login || null,
        mailbox_password: String(draft.mailbox_password || '').trim() || null,
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
        email: draft.email || null,
        mailbox_email: draft.mailbox_email || null,
        mailbox_login: draft.mailbox_login || null,
        mailbox_password: String(draft.mailbox_password || '').trim() || undefined,
        role: draft.role || 'viewer',
        auth_source: draft.auth_source || 'local',
        telegram_id: draft.telegram_id ? Number(draft.telegram_id) : null,
        assigned_database: draft.assigned_database || null,
        is_active: Boolean(draft.is_active),
        use_custom_permissions: Boolean(draft.use_custom_permissions),
        custom_permissions: normalizePermissions(draft.custom_permissions),
      };
      const updated = await authAPI.updateUser(userId, payload);
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

            <SettingsTabPanel active={tab === 'env' && isAdmin}>
              <EnvVariablesTab
                envState={envState}
                loading={envLoading}
                saving={savingEnv}
                onRefresh={loadEnv}
                onSave={handleSaveEnv}
              />
            </SettingsTabPanel>
          </Box>
        </Paper>
      </PageShell>
    </MainLayout>
  );
}

export default Settings;
