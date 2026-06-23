import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import AddTaskRoundedIcon from '@mui/icons-material/AddTaskRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { hubAPI } from '../api/client';
import { chatNotificationsAPI } from '../api/chatNotifications';
import { mailNotificationsAPI } from '../api/mailNotifications';
import { useAuth } from '../contexts/AuthContext';
import {
  DEFAULT_DASHBOARD_SECTIONS,
  normalizeDashboardSections,
  usePreferences,
} from '../contexts/PreferencesContext';
import { CHAT_FEATURE_ENABLED } from '../lib/chatFeature';
import {
  buildOfficeUiTokens,
  getOfficeEmptyStateSx,
  getOfficePanelSx,
} from '../theme/officeUiTokens';

const DASHBOARD_ANNOUNCEMENTS_LIMIT = 12;
const DASHBOARD_TASKS_LIMIT = 40;
const OPTIONAL_SECTION_KEYS = ['tasks', 'communication', 'news'];
const normalizeDashboardLayoutSections = (value, legacyValue) => {
  const normalized = normalizeDashboardSections(value, legacyValue);
  return [
    'attention',
    ...(normalized.includes('tasks') ? ['tasks'] : []),
    ...normalized.filter((key) => ['communication', 'news'].includes(key)),
  ];
};

const SECTION_META = {
  attention: {
    title: 'Требует внимания',
    description: 'То, где нужна ваша реакция сейчас.',
  },
  tasks: {
    title: 'Ближайшие задачи',
    description: 'До пяти открытых задач с ближайшими сроками.',
  },
  communication: {
    title: 'Связь',
    description: 'Непрочитанные сообщения и уведомления.',
  },
  news: {
    title: 'Последние новости',
    description: 'Новые и важные сообщения компании.',
  },
};

const EMPTY_DASHBOARD = {
  announcements: { items: [], total: 0 },
  my_tasks: { items: [], total: 0 },
  unread_counts: {},
  summary: {},
};

const formatShortDateTime = (value) => {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDueLabel = (value) => {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) return 'Без срока';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const time = parsed.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diffDays < 0) return `Просрочено · ${parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}`;
  if (diffDays === 0) return `Сегодня · ${time}`;
  if (diffDays === 1) return `Завтра · ${time}`;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getGreeting = (date = new Date()) => {
  const hour = date.getHours();
  if (hour < 6) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
};

export const getFirstName = (user) => {
  const explicitFirstName = String(user?.first_name || '').trim();
  if (explicitFirstName) return explicitFirstName;
  const value = String(user?.full_name || user?.display_name || user?.username || '').trim();
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return parts[1];
  return parts[0] || 'коллега';
};

function SectionSurface({ sectionKey, children, action, emphasis = false }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const meta = SECTION_META[sectionKey];
  return (
    <Paper
      data-testid={`dashboard-section-${sectionKey}`}
      sx={getOfficePanelSx(ui, {
        position: 'relative',
        borderRadius: { xs: 0, sm: '18px' },
        borderWidth: { xs: 0, sm: 1 },
        bgcolor: { xs: 'transparent', sm: ui.panelSolid },
        boxShadow: 'none',
        overflow: 'hidden',
        minWidth: 0,
        ...(emphasis ? {
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: { xs: 0, sm: 18 },
            right: { xs: 0, sm: 18 },
            height: 3,
            borderRadius: '0 0 999px 999px',
            bgcolor: 'primary.main',
          },
        } : {}),
      })}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{
          minHeight: { xs: 44, sm: 56 },
          px: { xs: 0.25, sm: 1.6 },
          pt: emphasis ? { xs: 0.65, sm: 1.45 } : { xs: 0.4, sm: 1.25 },
          pb: { xs: 0.65, sm: 1 },
        }}
      >
        <Typography
          sx={{
            minWidth: 0,
            fontWeight: 900,
            lineHeight: 1.15,
            letterSpacing: '-0.015em',
            fontSize: emphasis ? { xs: '1.08rem', sm: '1.24rem' } : { xs: '1rem', sm: '1.08rem' },
          }}
        >
          {meta.title}
        </Typography>
        {action}
      </Stack>
      <Box sx={{ px: { xs: 0, sm: 1.25 }, pb: { xs: 0.35, sm: 1.2 } }}>{children}</Box>
    </Paper>
  );
}

function AttentionRow({
  icon,
  title,
  secondary,
  tone = 'default',
  onClick,
}) {
  const theme = useTheme();
  const toneColor = tone === 'error'
    ? theme.palette.error.main
    : tone === 'warning'
      ? theme.palette.warning.main
      : theme.palette.primary.main;
  return (
    <ButtonBase
      data-testid="dashboard-task-row"
      onClick={onClick}
      sx={{
        width: '100%',
        minHeight: 58,
        px: 1,
        py: 0.75,
        borderRadius: '12px',
        justifyContent: 'flex-start',
        textAlign: 'left',
        bgcolor: alpha(toneColor, theme.palette.mode === 'dark' ? 0.09 : 0.045),
        border: '1px solid',
        borderColor: alpha(toneColor, theme.palette.mode === 'dark' ? 0.18 : 0.12),
        '&:hover': { bgcolor: alpha(toneColor, theme.palette.mode === 'dark' ? 0.14 : 0.08) },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            color: toneColor,
            bgcolor: alpha(toneColor, theme.palette.mode === 'dark' ? 0.18 : 0.1),
            '& .MuiSvgIcon-root': { fontSize: 19 },
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 750, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis' }}
            noWrap
          >
            {title}
          </Typography>
          {secondary ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }} noWrap>
              {secondary}
            </Typography>
          ) : null}
        </Box>
        <ChevronRightRoundedIcon sx={{ color: alpha(toneColor, 0.7), flexShrink: 0 }} />
      </Stack>
    </ButtonBase>
  );
}

function TaskQueueRow({ task, onClick }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const overdue = Boolean(task?.is_overdue);
  const inReview = String(task?.status || '').toLowerCase() === 'review';
  const hasDueDate = !Number.isNaN(Date.parse(task?.due_at || ''));
  const dueColor = overdue
    ? theme.palette.error.main
    : inReview
      ? theme.palette.warning.main
      : hasDueDate
        ? theme.palette.primary.main
        : ui.iconMuted;
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        minHeight: { xs: 64, sm: 72 },
        px: { xs: 0.25, sm: 0.65 },
        py: 0.65,
        borderRadius: '12px',
        justifyContent: 'flex-start',
        textAlign: 'left',
        '&:hover': { bgcolor: ui.actionHover },
      }}
    >
      <Stack direction="row" spacing={{ xs: 0.8, sm: 1 }} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
        <Box sx={{ width: 18, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Box
            data-testid="dashboard-task-status-dot"
            sx={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              bgcolor: dueColor,
              boxShadow: `0 0 0 4px ${alpha(dueColor, theme.palette.mode === 'dark' ? 0.16 : 0.1)}`,
            }}
          />
        </Box>
        <Stack
          direction="row"
          spacing={1}
          justifyContent="space-between"
          alignItems="center"
          sx={{ flex: 1, minWidth: 0 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{ fontWeight: 800, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis' }}
              noWrap
            >
              {task?.title || 'Задача'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {inReview ? 'Ожидает проверки' : 'Открытая задача'}
            </Typography>
          </Box>
          <Typography
            variant="caption"
            sx={{
              color: dueColor,
              fontWeight: 850,
              flexShrink: 0,
              px: { xs: 0.35, sm: 1 },
              py: { xs: 0.2, sm: 0.4 },
              borderRadius: '999px',
              bgcolor: alpha(dueColor, theme.palette.mode === 'dark' ? 0.12 : 0.07),
              whiteSpace: 'nowrap',
            }}
          >
            {formatDueLabel(task?.due_at)}
          </Typography>
        </Stack>
      </Stack>
    </ButtonBase>
  );
}

function CommunicationRow({ icon, title, secondary, count, onClick }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const hasUnread = Number(count || 0) > 0;
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        minHeight: 56,
        px: { xs: 0.35, sm: 0.65 },
        py: 0.55,
        borderRadius: '12px',
        justifyContent: 'flex-start',
        textAlign: 'left',
        '&:hover': { bgcolor: ui.actionHover },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
        <Box sx={{ color: hasUnread ? 'primary.main' : ui.iconMuted, display: 'grid', placeItems: 'center' }}>
          {icon}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>{title}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {secondary}
          </Typography>
        </Box>
        <Typography
          aria-label={`${title}: ${Number(count || 0)}`}
          sx={{
            minWidth: 34,
            textAlign: 'right',
            fontWeight: 900,
            fontSize: hasUnread ? '1.15rem' : '0.9rem',
            color: hasUnread ? 'primary.main' : 'text.disabled',
          }}
        >
          {hasUnread ? count : '—'}
        </Typography>
      </Stack>
    </ButtonBase>
  );
}

function NewsRow({ item, onClick }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        minHeight: 68,
        px: { xs: 0.35, sm: 0.65 },
        py: 0.75,
        borderRadius: '12px',
        justifyContent: 'flex-start',
        textAlign: 'left',
        '&:hover': { bgcolor: ui.actionHover },
      }}
    >
      <Box sx={{ width: '100%', minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.25 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {formatShortDateTime(item?.updated_at || item?.published_at || item?.created_at)}
          </Typography>
          {item?.is_ack_pending ? (
            <Chip
              size="small"
              label="Важно"
              color="warning"
              variant="outlined"
              sx={{ height: 22, fontWeight: 800 }}
            />
          ) : null}
        </Stack>
        <Typography variant="body2" sx={{ fontWeight: 850, lineHeight: 1.25 }} noWrap>
          {item?.title || 'Объявление'}
        </Typography>
        {item?.preview ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: '-webkit-box',
              mt: 0.2,
              overflow: 'hidden',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: 1.35,
            }}
          >
            {item.preview}
          </Typography>
        ) : null}
      </Box>
    </ButtonBase>
  );
}

function EmptySection({ title, text }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  return (
    <Box sx={getOfficeEmptyStateSx(ui, {
      p: { xs: 1, sm: 1.25 },
      borderRadius: { xs: '10px', sm: '12px' },
      borderWidth: { xs: 0, sm: 1 },
      bgcolor: { xs: 'transparent', sm: ui.emptyStateBg },
    })}
    >
      <Typography variant="body2" sx={{ fontWeight: 750 }}>{title}</Typography>
      {text ? <Typography variant="caption" color="text.secondary">{text}</Typography> : null}
    </Box>
  );
}

function DashboardCustomizeDialog({ open, sections, saving, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normalizeDashboardLayoutSections(sections));

  useEffect(() => {
    if (open) setDraft(normalizeDashboardLayoutSections(sections));
  }, [open, sections]);

  const tasksVisible = draft.includes('tasks');
  const visibleSecondary = draft.filter((item) => ['communication', 'news'].includes(item));
  const hiddenOptional = OPTIONAL_SECTION_KEYS.filter((item) => !draft.includes(item));

  const move = (key, direction) => {
    setDraft((current) => {
      const next = [...current];
      const index = next.indexOf(key);
      const secondaryIndexes = next
        .map((item, itemIndex) => (['communication', 'news'].includes(item) ? itemIndex : -1))
        .filter((itemIndex) => itemIndex >= 0);
      const secondaryPosition = secondaryIndexes.indexOf(index);
      const targetPosition = secondaryPosition + direction;
      if (secondaryPosition < 0 || targetPosition < 0 || targetPosition >= secondaryIndexes.length) return current;
      const target = secondaryIndexes[targetPosition];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const toggle = (key) => {
    setDraft((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (key === 'tasks') return ['attention', 'tasks', ...current.filter((item) => item !== 'attention')];
      return [...current, key];
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Настроить главную</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1}>
          <Paper variant="outlined" sx={{ p: 1, borderRadius: '12px' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography sx={{ fontWeight: 800 }}>Требует внимания</Typography>
                <Typography variant="caption" color="text.secondary">
                  Всегда показывается первым.
                </Typography>
              </Box>
              <Chip size="small" color="primary" label="Всегда" />
            </Stack>
          </Paper>

          {tasksVisible ? (
            <Paper variant="outlined" sx={{ p: 1, borderRadius: '12px' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 800 }}>{SECTION_META.tasks.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Основная рабочая область, всегда располагается первой.
                  </Typography>
                </Box>
                <Chip size="small" label="Основной" variant="outlined" />
                <IconButton aria-label={`Скрыть ${SECTION_META.tasks.title}`} onClick={() => toggle('tasks')}>
                  <VisibilityOffOutlinedIcon />
                </IconButton>
              </Stack>
            </Paper>
          ) : null}

          {visibleSecondary.map((key, index) => (
            <Paper key={key} variant="outlined" sx={{ p: 1, borderRadius: '12px' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 800 }}>{SECTION_META[key].title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {SECTION_META[key].description}
                  </Typography>
                </Box>
                <IconButton
                  aria-label={`Поднять ${SECTION_META[key].title}`}
                  disabled={index === 0}
                  onClick={() => move(key, -1)}
                >
                  <KeyboardArrowUpRoundedIcon />
                </IconButton>
                <IconButton
                  aria-label={`Опустить ${SECTION_META[key].title}`}
                  disabled={index === visibleSecondary.length - 1}
                  onClick={() => move(key, 1)}
                >
                  <KeyboardArrowDownRoundedIcon />
                </IconButton>
                <IconButton aria-label={`Скрыть ${SECTION_META[key].title}`} onClick={() => toggle(key)}>
                  <VisibilityOffOutlinedIcon />
                </IconButton>
              </Stack>
            </Paper>
          ))}

          {hiddenOptional.length ? (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Скрытые блоки
              </Typography>
              <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
                {hiddenOptional.map((key) => (
                  <Button
                    key={key}
                    size="small"
                    variant="outlined"
                    startIcon={<VisibilityOutlinedIcon />}
                    onClick={() => toggle(key)}
                  >
                    {SECTION_META[key].title}
                  </Button>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.2 }}>
        <Button
          startIcon={<RestartAltRoundedIcon />}
          onClick={() => setDraft([...DEFAULT_DASHBOARD_SECTIONS])}
        >
          По умолчанию
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Отмена</Button>
        <Button
          data-testid="dashboard-customize-save"
          variant="contained"
          disabled={saving}
          onClick={() => onSave(normalizeDashboardLayoutSections(draft))}
        >
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Dashboard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission } = useAuth();
  const { preferences, savePreferences } = usePreferences();
  const [payload, setPayload] = useState(EMPTY_DASHBOARD);
  const [communicationCounts, setCommunicationCounts] = useState({ chat: 0, mail: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [customizeSaving, setCustomizeSaving] = useState(false);

  const announcementId = useMemo(
    () => String(new URLSearchParams(location.search || '').get('announcement') || '').trim(),
    [location.search],
  );

  const canReadTasks = hasPermission('tasks.read');
  const canCreateTasks = hasPermission('tasks.create') || hasPermission('tasks.write');
  const canReadMail = hasPermission('mail.access');
  const canReadChat = CHAT_FEATURE_ENABLED && hasPermission('chat.read');
  const canReadNews = hasPermission('dashboard.read');

  const sections = useMemo(() => {
    const normalized = normalizeDashboardLayoutSections(
      preferences?.dashboard_sections,
      preferences?.dashboard_mobile_sections,
    );
    return normalized.filter((key) => {
      if (key === 'tasks') return canReadTasks;
      if (key === 'communication') return canReadMail || canReadChat || hasPermission('notifications.read');
      if (key === 'news') return canReadNews;
      return true;
    });
  }, [
    canReadChat,
    canReadMail,
    canReadNews,
    canReadTasks,
    hasPermission,
    preferences?.dashboard_mobile_sections,
    preferences?.dashboard_sections,
  ]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    const [dashboardResult, chatResult, mailResult] = await Promise.allSettled([
      hubAPI.getDashboard({
        announcements_limit: DASHBOARD_ANNOUNCEMENTS_LIMIT,
        tasks_limit: DASHBOARD_TASKS_LIMIT,
      }),
      canReadChat ? chatNotificationsAPI.getUnreadSummary() : Promise.resolve(null),
      canReadMail ? mailNotificationsAPI.getUnreadCount({ force: true }) : Promise.resolve(null),
    ]);

    if (dashboardResult.status === 'fulfilled') {
      setPayload(dashboardResult.value || EMPTY_DASHBOARD);
    } else {
      setPayload(EMPTY_DASHBOARD);
      setError(
        dashboardResult.reason?.response?.data?.detail
        || dashboardResult.reason?.message
        || 'Не удалось загрузить главную страницу.',
      );
    }
    setCommunicationCounts({
      chat: chatResult.status === 'fulfilled'
        ? Number(chatResult.value?.messages_unread_total || chatResult.value?.unread_total || 0)
        : 0,
      mail: mailResult.status === 'fulfilled'
        ? Number(mailResult.value?.unread_count || mailResult.value?.total_unread || 0)
        : 0,
    });
    setLoading(false);
  }, [canReadChat, canReadMail]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const taskItems = useMemo(
    () => (Array.isArray(payload?.my_tasks?.items) ? payload.my_tasks.items : []),
    [payload?.my_tasks?.items],
  );
  const announcementItems = useMemo(
    () => (Array.isArray(payload?.announcements?.items) ? payload.announcements.items : []),
    [payload?.announcements?.items],
  );
  const unreadCounts = payload?.unread_counts || {};

  const reviewTasks = useMemo(() => taskItems.filter((task) => (
    String(task?.status || '').toLowerCase() === 'review'
    && (
      String(user?.role || '').toLowerCase() === 'admin'
      || Number(task?.created_by_user_id) === Number(user?.id)
      || Number(task?.controller_user_id) === Number(user?.id)
    )
  )), [taskItems, user?.id, user?.role]);

  const attentionItems = useMemo(() => {
    const result = [];
    const seen = new Set();
    const addTask = (task, kind) => {
      const id = String(task?.id || '');
      if (!id || seen.has(`task:${id}`)) return;
      seen.add(`task:${id}`);
      result.push({ type: 'task', kind, id, item: task });
    };
    taskItems.filter((task) => task?.is_overdue).forEach((task) => addTask(task, 'overdue'));
    reviewTasks.forEach((task) => addTask(task, 'review'));
    taskItems.filter((task) => task?.has_unread_comments).forEach((task) => addTask(task, 'comments'));
    announcementItems
      .filter((item) => item?.is_ack_pending)
      .forEach((item) => {
        const id = String(item?.id || '');
        if (!id || seen.has(`announcement:${id}`)) return;
        seen.add(`announcement:${id}`);
        result.push({ type: 'announcement', kind: 'ack', id, item });
      });
    return result.slice(0, 6);
  }, [announcementItems, reviewTasks, taskItems]);

  const nearestTasks = useMemo(() => (
    taskItems
      .filter((task) => !['done', 'cancelled', 'canceled'].includes(String(task?.status || '').toLowerCase()))
      .sort((left, right) => {
        const leftDue = Date.parse(left?.due_at || '') || Number.MAX_SAFE_INTEGER;
        const rightDue = Date.parse(right?.due_at || '') || Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      })
      .slice(0, 5)
  ), [taskItems]);

  const latestNews = useMemo(() => (
    [...announcementItems]
      .sort((left, right) => (
        (Date.parse(right?.updated_at || right?.published_at || right?.created_at || '') || 0)
        - (Date.parse(left?.updated_at || left?.published_at || left?.created_at || '') || 0)
      ))
      .slice(0, 3)
  ), [announcementItems]);

  const communicationRows = useMemo(() => {
    const rows = [];
    if (canReadMail) {
      rows.push({
        key: 'mail',
        title: 'Почта',
        secondary: communicationCounts.mail > 0 ? 'Есть непрочитанные письма' : 'Новых писем нет',
        count: communicationCounts.mail,
        icon: <MailOutlineRoundedIcon />,
        path: '/mail',
      });
    }
    if (canReadChat) {
      rows.push({
        key: 'chat',
        title: 'Чат',
        secondary: communicationCounts.chat > 0 ? 'Есть новые сообщения' : 'Новых сообщений нет',
        count: communicationCounts.chat,
        icon: <ForumOutlinedIcon />,
        path: '/chat',
      });
    }
    rows.push({
      key: 'notifications',
      title: 'Уведомления',
      secondary: Number(unreadCounts?.notifications_unread_total || 0) > 0
        ? 'Есть события, которые вы ещё не открыли'
        : 'Новых уведомлений нет',
      count: Number(unreadCounts?.notifications_unread_total || 0),
      icon: <NotificationsNoneRoundedIcon />,
      onClick: () => window.dispatchEvent(new CustomEvent('hub-open-notifications')),
    });
    return rows;
  }, [canReadChat, canReadMail, communicationCounts.chat, communicationCounts.mail, unreadCounts?.notifications_unread_total]);

  const quickActions = useMemo(() => [
    canCreateTasks ? {
      key: 'task',
      label: 'Создать задачу',
      icon: <AddTaskRoundedIcon />,
      path: '/tasks?create=1',
    } : null,
    canReadChat ? {
      key: 'chat',
      label: 'Открыть чат',
      icon: <ForumOutlinedIcon />,
      path: '/chat',
    } : null,
    canReadMail ? {
      key: 'mail',
      label: 'Написать письмо',
      icon: <SendRoundedIcon />,
      path: '/mail?compose=new',
    } : null,
  ].filter(Boolean), [canCreateTasks, canReadChat, canReadMail]);
  const primaryQuickAction = quickActions.find((item) => item.key === 'task');
  const secondaryQuickActions = quickActions.filter((item) => item.key !== 'task');

  const handleSaveSections = async (nextSections) => {
    setCustomizeSaving(true);
    try {
      await savePreferences({ dashboard_sections: nextSections });
      setCustomizeOpen(false);
    } catch (saveError) {
      setError(saveError?.message || 'Не удалось сохранить настройку главной страницы.');
    } finally {
      setCustomizeSaving(false);
    }
  };

  if (announcementId) {
    return <Navigate to={`/dashboard/news${location.search}`} replace />;
  }

  const todayLabel = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const renderAttention = () => {
    if (loading) {
      return (
        <Paper
          data-testid="dashboard-section-attention"
          sx={getOfficePanelSx(ui, {
            p: 1,
            borderRadius: { xs: '13px', sm: '16px' },
            boxShadow: 'none',
          })}
        >
          <Skeleton height={42} />
        </Paper>
      );
    }

    if (!attentionItems.length) {
      return (
        <Paper
          data-testid="dashboard-section-attention"
          data-state="calm"
          sx={{
            minHeight: 48,
            px: { xs: 1, sm: 1.35 },
            py: 0.65,
            borderRadius: { xs: '13px', sm: '16px' },
            border: '1px solid',
            borderColor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.28 : 0.2),
            bgcolor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.09 : 0.055),
            boxShadow: 'none',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Stack direction="row" spacing={0.9} alignItems="center" sx={{ minWidth: 0 }}>
            <CheckCircleRoundedIcon sx={{ color: 'success.main', fontSize: 21 }} />
            <Typography variant="body2" sx={{ fontWeight: 850, color: 'success.main' }}>
              Всё спокойно
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: 'none', sm: 'block' } }}
            >
              Нет просроченных задач и обязательных подтверждений.
            </Typography>
          </Stack>
        </Paper>
      );
    }

    const hasOverdue = attentionItems.some((item) => item.kind === 'overdue');
    const attentionColor = hasOverdue ? theme.palette.error.main : theme.palette.warning.main;
    return (
      <Paper
        data-testid="dashboard-section-attention"
        data-state="active"
        sx={{
          position: 'relative',
          p: { xs: 1, sm: 1.25 },
          pl: { xs: 1.25, sm: 1.6 },
          borderRadius: { xs: '15px', sm: '18px' },
          border: '1px solid',
          borderColor: alpha(attentionColor, theme.palette.mode === 'dark' ? 0.32 : 0.22),
          bgcolor: alpha(attentionColor, theme.palette.mode === 'dark' ? 0.055 : 0.025),
          boxShadow: 'none',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: '0 auto 0 0',
            width: 4,
            bgcolor: attentionColor,
          },
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.85 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <WarningAmberRoundedIcon sx={{ color: attentionColor, fontSize: 21 }} />
            <Typography sx={{ fontWeight: 900, fontSize: { xs: '1rem', sm: '1.08rem' } }}>
              Требует внимания
            </Typography>
          </Stack>
          <Chip
            size="small"
            label={attentionItems.length}
            sx={{
              height: 24,
              minWidth: 30,
              fontWeight: 900,
              color: attentionColor,
              bgcolor: alpha(attentionColor, theme.palette.mode === 'dark' ? 0.14 : 0.09),
            }}
          />
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 0.7,
          }}
        >
          {attentionItems.map((entry) => {
            const task = entry.item;
            if (entry.type === 'announcement') {
              return (
                <AttentionRow
                  key={`announcement-${entry.id}`}
                  icon={<CampaignOutlinedIcon />}
                  title={entry.item?.title || 'Обязательное объявление'}
                  secondary="Нужно прочитать и подтвердить"
                  tone="warning"
                  onClick={() => navigate(`/dashboard/news?announcement=${encodeURIComponent(entry.id)}`)}
                />
              );
            }
            const meta = entry.kind === 'overdue'
              ? { icon: <WarningAmberRoundedIcon />, secondary: formatDueLabel(task?.due_at), tone: 'error' }
              : entry.kind === 'review'
                ? { icon: <FactCheckOutlinedIcon />, secondary: 'Ожидает вашей проверки', tone: 'warning' }
                : { icon: <ModeCommentOutlinedIcon />, secondary: 'Есть новый комментарий', tone: 'default' };
            return (
              <AttentionRow
                key={`task-${entry.id}`}
                icon={meta.icon}
                title={task?.title || 'Задача'}
                secondary={meta.secondary}
                tone={meta.tone}
                onClick={() => navigate(`/tasks?task=${encodeURIComponent(entry.id)}`)}
              />
            );
          })}
        </Box>
      </Paper>
    );
  };

  const sectionNodes = {
    tasks: (
      <SectionSurface
        key="tasks"
        sectionKey="tasks"
        emphasis
        action={(
          <Button size="small" onClick={() => navigate('/tasks')} endIcon={<ChevronRightRoundedIcon />}>
            Все задачи
          </Button>
        )}
      >
        {loading ? (
          <Stack spacing={0.5}>{[0, 1, 2].map((item) => <Skeleton key={item} height={56} />)}</Stack>
        ) : nearestTasks.length ? (
          <Stack divider={<Divider sx={{ ml: 3.2, borderColor: ui.borderSoft }} />}>
            {nearestTasks.map((task) => (
              <TaskQueueRow
                key={String(task.id)}
                task={task}
                onClick={() => navigate(`/tasks?task=${encodeURIComponent(String(task.id))}`)}
              />
            ))}
          </Stack>
        ) : (
          <EmptySection title="Открытых задач нет" text="Новые задачи появятся здесь автоматически." />
        )}
      </SectionSurface>
    ),
    communication: (
      <SectionSurface key="communication" sectionKey="communication">
        <Stack divider={<Divider sx={{ borderColor: ui.borderSoft }} />}>
          {communicationRows.map((item) => (
            <CommunicationRow
              key={item.key}
              icon={item.icon}
              title={item.title}
              secondary={item.secondary}
              count={item.count}
              onClick={item.onClick || (() => navigate(item.path))}
            />
          ))}
        </Stack>
      </SectionSurface>
    ),
    news: (
      <SectionSurface
        key="news"
        sectionKey="news"
        action={(
          <Button size="small" onClick={() => navigate('/dashboard/news')} endIcon={<ChevronRightRoundedIcon />}>
            Все новости
          </Button>
        )}
      >
        {loading ? (
          <Stack spacing={0.5}>{[0, 1, 2].map((item) => <Skeleton key={item} height={56} />)}</Stack>
        ) : latestNews.length ? (
          <Stack divider={<Divider sx={{ borderColor: ui.borderSoft }} />}>
            {latestNews.map((item) => (
              <NewsRow
                key={String(item.id)}
                item={item}
                onClick={() => navigate(`/dashboard/news?announcement=${encodeURIComponent(String(item.id))}`)}
              />
            ))}
          </Stack>
        ) : (
          <EmptySection title="Новых объявлений нет" text="Последние сообщения компании появятся здесь." />
        )}
      </SectionSurface>
    ),
  };

  const tasksVisible = sections.includes('tasks');
  const secondarySectionKeys = sections.filter((key) => ['communication', 'news'].includes(key));
  const renderedSectionOrder = [
    'attention',
    ...(tasksVisible ? ['tasks'] : []),
    ...secondarySectionKeys,
  ];
  const hasSecondarySections = secondarySectionKeys.length > 0;

  return (
    <MainLayout>
      <PageShell sx={{ pb: isMobile ? 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 8px)' : undefined }}>
        <Stack spacing={{ xs: 1, sm: 1.25 }} sx={{ maxWidth: 1320, mx: 'auto', width: '100%' }}>
          <Paper
            data-testid="dashboard-today-header"
            sx={{
              p: { xs: 1.1, sm: 1.3 },
              borderRadius: { xs: '16px', sm: '19px' },
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.6),
              bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.76 : 0.86),
              backgroundImage: `linear-gradient(115deg, ${alpha(theme.palette.primary.main, 0.12)}, transparent 54%)`,
              boxShadow: 'none',
            }}
          >
            <Stack spacing={0.9}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: { xs: '1.28rem', sm: '1.55rem' },
                      lineHeight: 1.12,
                      fontWeight: 900,
                      letterSpacing: '-0.025em',
                    }}
                  >
                    {getGreeting()}, {getFirstName(user)}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ mt: 0.35, textTransform: 'capitalize', fontSize: { xs: '0.86rem', sm: '0.95rem' } }}
                  >
                    {todayLabel}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    aria-label="Обновить главную"
                    onClick={() => void loadDashboard()}
                    disabled={loading}
                    sx={{ width: 48, height: 48 }}
                  >
                    {loading ? <CircularProgress size={20} /> : <RefreshRoundedIcon />}
                  </IconButton>
                  <IconButton
                    aria-label="Настроить главную"
                    onClick={() => setCustomizeOpen(true)}
                    sx={{ width: 48, height: 48 }}
                  >
                    <TuneRoundedIcon />
                  </IconButton>
                </Stack>
              </Stack>

              {quickActions.length ? (
                <Stack direction="row" spacing={0.7} alignItems="center">
                  {primaryQuickAction ? (
                    <Button
                      data-testid="dashboard-primary-action"
                      variant="contained"
                      startIcon={primaryQuickAction.icon}
                      onClick={() => navigate(primaryQuickAction.path)}
                      sx={{
                        minHeight: 48,
                        px: 1.5,
                        borderRadius: '12px',
                        fontWeight: 850,
                        flex: { xs: 1, sm: '0 0 auto' },
                        boxShadow: 'none',
                      }}
                    >
                      {primaryQuickAction.label}
                    </Button>
                  ) : null}
                  <Stack direction="row" spacing={0.6}>
                    {secondaryQuickActions.map((item) => (
                      <Tooltip key={item.key} title={item.label}>
                        <IconButton
                          aria-label={item.label}
                          onClick={() => navigate(item.path)}
                          sx={{
                            width: 48,
                            height: 48,
                            border: '1px solid',
                            borderColor: ui.actionBorder,
                            borderRadius: '12px',
                            color: 'primary.main',
                            bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.45 : 0.7),
                            '&:hover': { bgcolor: ui.actionHover },
                          }}
                        >
                          {item.icon}
                        </IconButton>
                      </Tooltip>
                    ))}
                  </Stack>
                </Stack>
              ) : null}
            </Stack>
          </Paper>

          {error ? <Alert severity="error">{error}</Alert> : null}

          {renderAttention()}

          <Box
            data-testid="dashboard-sections"
            data-dashboard-order={renderedSectionOrder.join(',')}
            data-layout={isMobile ? 'mobile-feed' : (tasksVisible && hasSecondarySections ? 'desktop-focus' : 'desktop-full')}
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                md: tasksVisible && hasSecondarySections
                  ? 'minmax(0, 7fr) minmax(320px, 5fr)'
                  : 'minmax(0, 1fr)',
              },
              gap: { xs: 1.1, sm: 1.25 },
              alignItems: 'start',
            }}
          >
            {tasksVisible ? sectionNodes.tasks : null}
            {hasSecondarySections ? (
              <Stack
                data-testid="dashboard-secondary-column"
                spacing={{ xs: 1.1, sm: 1.25 }}
                sx={{ minWidth: 0 }}
              >
                {secondarySectionKeys.map((key) => sectionNodes[key]).filter(Boolean)}
              </Stack>
            ) : null}
          </Box>
        </Stack>

        <DashboardCustomizeDialog
          open={customizeOpen}
          sections={normalizeDashboardLayoutSections(
            preferences?.dashboard_sections,
            preferences?.dashboard_mobile_sections,
          )}
          saving={customizeSaving}
          onClose={() => setCustomizeOpen(false)}
          onSave={(next) => { void handleSaveSections(next); }}
        />
      </PageShell>
    </MainLayout>
  );
}
