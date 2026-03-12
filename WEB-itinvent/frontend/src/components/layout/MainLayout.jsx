/**
 * Main Layout component - AppBar and Sidebar navigation.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar,
  Badge,
  Box,
  Toolbar,
  Typography,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemButton,
  ListItemText,
  Divider,
  Button,
  FormControl,
  Select,
  MenuItem,
  Chip,
  Stack,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import StorageIcon from '@mui/icons-material/Storage';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import BarChartIcon from '@mui/icons-material/BarChart';
import LanIcon from '@mui/icons-material/Lan';
import ComputerIcon from '@mui/icons-material/Computer';
import PrintIcon from '@mui/icons-material/Print';
import ShieldIcon from '@mui/icons-material/Policy';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import AssignmentIcon from '@mui/icons-material/Assignment';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import GroupIcon from '@mui/icons-material/Group';
import VideocamIcon from '@mui/icons-material/Videocam';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import apiClient, { mailAPI } from '../../api/client';
import { getOrFetchSWR, buildCacheKey } from '../../lib/swrCache';
import { buildOfficeUiTokens, getOfficeEmptyStateSx, getOfficePanelSx, getOfficeQuietActionSx } from '../../theme/officeUiTokens';

const DRAWER_WIDTH = 240;
const KB_WIKI_URL = 'https://wiki.zsgp.ru/';
const HUB_POLL_INTERVAL_MS = 20_000;
const TOAST_SOURCE_LABELS = {
  hub: 'Центр управления',
  mail: 'Почта',
  settings: 'Настройки',
  database: 'IT-invent WEB',
  networks: 'Сети',
  tasks: 'Задачи',
  statistics: 'Статистика',
  mfu: 'МФУ',
  'ad-users': 'Пользователи AD',
  vcs: 'ВКС',
  'database-switch': 'Переключение БД',
};
const TOAST_SEVERITY_META = {
  success: { color: '#22c55e', icon: CheckCircleOutlineRoundedIcon, label: 'Успех' },
  error: { color: '#ef4444', icon: ErrorOutlineRoundedIcon, label: 'Ошибка' },
  warning: { color: '#f59e0b', icon: WarningAmberRoundedIcon, label: 'Предупреждение' },
  info: { color: '#3b82f6', icon: InfoOutlinedIcon, label: 'Информация' },
};


const navigationItems = [
  { path: '/dashboard', label: 'Центр управления', icon: <DashboardIcon />, permission: 'dashboard.read' },
  { path: '/tasks', label: 'Задачи', icon: <TaskAltIcon />, permission: 'tasks.read' },
  { path: '/mail', label: 'Почта', icon: <MailOutlineIcon />, permission: 'mail.access' },
  { path: '/database', label: 'IT-invent WEB', icon: <StorageIcon />, permission: 'database.read' },
  { path: '/networks', label: 'Сети', icon: <LanIcon />, permission: 'networks.read' },
  { path: '/ad-users', label: 'Пользователи AD', icon: <GroupIcon />, permission: 'ad_users.read' },
  { path: '/vcs', label: 'ВКС терминалы', icon: <VideocamIcon />, permission: 'vcs.read' },
  { path: '/mfu', label: 'МФУ', icon: <PrintIcon />, permission: 'database.read' },
  { path: '/computers', label: 'Компьютеры', icon: <ComputerIcon />, permission: 'computers.read' },
  { path: '/scan-center', label: 'Scan Center', icon: <ShieldIcon />, permission: 'scan.read' },
  { path: '/statistics', label: 'Статистика', icon: <BarChartIcon />, permission: 'statistics.read' },
  { path: '/kb', label: 'IT База знаний', icon: <MenuBookIcon />, permission: 'kb.read', externalUrl: KB_WIKI_URL },
  { path: '/settings', label: 'Настройки', icon: <SettingsIcon />, permission: 'settings.read' },
];

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed';
const normalizeDbId = (value) => String(value ?? '').trim();
const SWR_STALE_TIME_MS = 30_000;

const formatPanelDateTime = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  const now = new Date();
  const sameDay = parsed.toDateString() === now.toDateString();
  return sameDay
    ? parsed.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : parsed.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
};

function MainLayout({ children }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return saved === 'true';
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuth();
  const {
    notifyApiError,
    notifyInfo,
    toastHistory,
    clearToastHistory,
    hasSeenHubNotification,
    markHubNotificationsSeen,
  } = useNotification();
  const [databases, setDatabases] = useState([]);
  const [currentDb, setCurrentDb] = useState(null);
  const [dbLocked, setDbLocked] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({
    notifications_unread_total: 0,
    announcements_unread: 0,
    announcements_ack_pending: 0,
    tasks_open_total: 0,
    tasks_open: 0,
    tasks_new: 0,
    tasks_assignee_open: 0,
    tasks_created_open: 0,
    tasks_controller_open: 0,
    tasks_review_required: 0,
    tasks_overdue: 0,
    tasks_with_unread_comments: 0,
    mail_unread: 0,
  });
  const lastPollRef = useRef('');
  const pollNotificationsRef = useRef(null);
  const hubPollBackoffUntilRef = useRef(0);
  const hubPollFailureCountRef = useRef(0);
  const hubPollLastWarnAtRef = useRef(0);
  const hubPollSuppressToastsRef = useRef(false);
  const hasSeenHubNotificationRef = useRef(hasSeenHubNotification);
  const markHubNotificationsSeenRef = useRef(markHubNotificationsSeen);
  const notifyInfoRef = useRef(notifyInfo);
  const hasDashboardPermission = hasPermission('dashboard.read');
  const hasMailPermission = hasPermission('mail.access');
  const isMailPage = location.pathname.startsWith('/mail');
  const visibleNavigationItems = navigationItems.filter(
    (item) => !item.permission || hasPermission(item.permission)
  );
  const showNotificationsButton = hasDashboardPermission || toastHistory.length > 0;
  const notificationsBadgeValue = hasDashboardPermission
    ? Number(unreadCounts?.notifications_unread_total || 0)
    : toastHistory.length;

  useEffect(() => {
    hasSeenHubNotificationRef.current = hasSeenHubNotification;
  }, [hasSeenHubNotification]);

  useEffect(() => {
    markHubNotificationsSeenRef.current = markHubNotificationsSeen;
  }, [markHubNotificationsSeen]);

  useEffect(() => {
    notifyInfoRef.current = notifyInfo;
  }, [notifyInfo]);

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newState));
  };

  // Fetch available databases
  useEffect(() => {
    const fetchDatabases = async () => {
      try {
        const cacheKey = buildCacheKey('database-list', normalizeDbId(localStorage.getItem('selected_database') || ''));
        const { data } = await getOrFetchSWR(
          cacheKey,
          async () => (await apiClient.get('/database/list')).data,
          { staleTimeMs: SWR_STALE_TIME_MS }
        );
        setDatabases(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error fetching databases:', error);
      }
    };

    const fetchCurrentDb = async () => {
      try {
        const cacheKey = buildCacheKey('database-current', normalizeDbId(localStorage.getItem('selected_database') || ''));
        const { data } = await getOrFetchSWR(
          cacheKey,
          async () => (await apiClient.get('/database/current')).data,
          { staleTimeMs: SWR_STALE_TIME_MS }
        );
        setCurrentDb({
          id: normalizeDbId(data?.id || data?.database_id || ''),
          name: data?.name || data?.database || data?.database_name || '',
        });
        setDbLocked(String(data?.locked || '') === 'true');
      } catch (error) {
        console.error('Error fetching current database:', error);
      }
    };

    fetchDatabases();
    fetchCurrentDb();
  }, []);

  useEffect(() => {
    if (databases.length === 0) return;

    const currentId = normalizeDbId(currentDb?.id);
    const storedId = normalizeDbId(localStorage.getItem('selected_database'));
    const preferredId = storedId || currentId;

    const selectedDb =
      databases.find((db) => normalizeDbId(db.id) === preferredId) ||
      databases.find((db) => normalizeDbId(db.id) === currentId) ||
      databases[0];

    if (!selectedDb) return;

    const selectedId = normalizeDbId(selectedDb.id);
    if (selectedId !== currentId || !currentDb?.name) {
      setCurrentDb({
        id: selectedId,
        name: selectedDb.name || currentDb?.name || '',
      });
    }

    localStorage.setItem('selected_database', selectedId);
  }, [databases, currentDb?.id, currentDb?.name]);

  useEffect(() => {
    if (!hasDashboardPermission && !hasMailPermission) return;

    let mounted = true;

    const fetchUnreadCounts = async () => {
      try {
        let notifTotal = 0;
        let annUnread = 0;
        let annAckPending = 0;
        let tasksOpenTotal = 0;
        let tasksOpen = 0;
        let tasksNew = 0;
        let tasksAssigneeOpen = 0;
        let tasksCreatedOpen = 0;
        let tasksControllerOpen = 0;
        let tasksReviewRequired = 0;
        let tasksOverdue = 0;
        let tasksWithUnreadComments = 0;
        let mailUnread = 0;

        const promises = [];
        if (hasDashboardPermission) {
          promises.push(apiClient.get('/hub/notifications/unread-counts').then(res => {
            const data = res?.data || {};
            notifTotal = Number(data.notifications_unread_total || 0);
            annUnread = Number(data.announcements_unread || 0);
            annAckPending = Number(data.announcements_ack_pending || 0);
            tasksOpenTotal = Number(data.tasks_open_total || data.tasks_open || 0);
            tasksOpen = Number(data.tasks_open || data.tasks_open_total || 0);
            tasksNew = Number(data.tasks_new || 0);
            tasksAssigneeOpen = Number(data.tasks_assignee_open || 0);
            tasksCreatedOpen = Number(data.tasks_created_open || 0);
            tasksControllerOpen = Number(data.tasks_controller_open || 0);
            tasksReviewRequired = Number(data.tasks_review_required || 0);
            tasksOverdue = Number(data.tasks_overdue || 0);
            tasksWithUnreadComments = Number(data.tasks_with_unread_comments || 0);
          }));
        }

        if (hasMailPermission) {
          promises.push(mailAPI.getUnreadCount().then(data => {
            mailUnread = Number(data?.unread_count || 0);
          }));
        }

        await Promise.allSettled(promises);

        if (!mounted) return;
        setUnreadCounts({
          notifications_unread_total: notifTotal + mailUnread,
          announcements_unread: annUnread,
          announcements_ack_pending: annAckPending,
          tasks_open_total: tasksOpenTotal,
          tasks_open: tasksOpen,
          tasks_new: tasksNew,
          tasks_assignee_open: tasksAssigneeOpen,
          tasks_created_open: tasksCreatedOpen,
          tasks_controller_open: tasksControllerOpen,
          tasks_review_required: tasksReviewRequired,
          tasks_overdue: tasksOverdue,
          tasks_with_unread_comments: tasksWithUnreadComments,
          mail_unread: mailUnread,
        });
      } catch (error) {
        console.error('Hub unread counts error:', error);
      }
    };

    const pollNotifications = async ({ forceFull = false, enableToasts = true, ignoreBackoff = false } = {}) => {
      if (document.visibilityState !== 'visible') return;
      if (!ignoreBackoff && Date.now() < Number(hubPollBackoffUntilRef.current || 0)) return;
      try {
        const sinceValue = forceFull ? '' : String(lastPollRef.current || '').trim();
        const response = await apiClient.get('/hub/notifications/poll', {
          params: {
            since: sinceValue || undefined,
            limit: 20,
          },
        });
        hubPollFailureCountRef.current = 0;
        hubPollBackoffUntilRef.current = 0;
        const payload = response?.data || {};
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (!mounted) return;

        if (items.length > 0) {
          const itemIds = items
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean);
          const maxTs = items.reduce((acc, item) => {
            const ts = String(item?.created_at || '').trim();
            if (!ts) return acc;
            return ts > acc ? ts : acc;
          }, String(lastPollRef.current || ''));
          lastPollRef.current = maxTs || lastPollRef.current;

          setNotifications((prev) => {
            const map = new Map((Array.isArray(prev) ? prev : []).map((item) => [String(item.id || ''), item]));
            items.forEach((item) => {
              const id = String(item?.id || '').trim();
              if (id) map.set(id, item);
            });
            return Array.from(map.values())
              .sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')))
              .slice(0, 60);
          });

          const shouldShowToasts = enableToasts && !forceFull && !hubPollSuppressToastsRef.current;
          if (shouldShowToasts) {
            items
              .slice()
              .reverse()
              .forEach((item) => {
                const id = String(item?.id || '').trim();
                if (!id || hasSeenHubNotificationRef.current?.(id)) return;
                const rawTitle = String(item?.title || '').trim();
                const rawBody = String(item?.body || '').trim();
                const toastMessage = rawBody || rawTitle || 'Новое уведомление';
                const toastTitle = rawBody ? (rawTitle || 'Новое уведомление') : 'Уведомление';
                notifyInfoRef.current?.(toastMessage, {
                  title: toastTitle,
                  source: 'hub',
                  channel: 'system',
                  dedupeMode: 'recent',
                  dedupeKey: `hub:${id}`,
                  durationMs: 5200,
                });
              });
          }

          markHubNotificationsSeenRef.current?.(itemIds);
        }

        if (hubPollSuppressToastsRef.current) {
          hubPollSuppressToastsRef.current = false;
        }

        if (hasDashboardPermission) {
          const counts = payload?.unread_counts || {};
          let mailUnread = 0;
          if (hasMailPermission) {
            try {
              const mailData = await mailAPI.getUnreadCount();
              mailUnread = Number(mailData?.unread_count || 0);
            } catch (e) { }
          }
          setUnreadCounts((prev) => {
            if (isMailPage && mailUnread > (prev.mail_unread || 0)) {
              window.dispatchEvent(new CustomEvent('mail-needs-refresh'));
              return prev;
            }
            if (mailUnread > (prev.mail_unread || 0)) {
              window.dispatchEvent(new CustomEvent('mail-needs-refresh'));
            }
            return {
              notifications_unread_total: Number(counts?.notifications_unread_total || 0) + mailUnread,
              announcements_unread: Number(counts?.announcements_unread || 0),
              announcements_ack_pending: Number(counts?.announcements_ack_pending || 0),
              tasks_open_total: Number(counts?.tasks_open_total || counts?.tasks_open || 0),
              tasks_open: Number(counts?.tasks_open || counts?.tasks_open_total || 0),
              tasks_new: Number(counts?.tasks_new || 0),
              tasks_assignee_open: Number(counts?.tasks_assignee_open || 0),
              tasks_created_open: Number(counts?.tasks_created_open || 0),
              tasks_controller_open: Number(counts?.tasks_controller_open || 0),
              tasks_review_required: Number(counts?.tasks_review_required || 0),
              tasks_overdue: Number(counts?.tasks_overdue || 0),
              tasks_with_unread_comments: Number(counts?.tasks_with_unread_comments || 0),
              mail_unread: mailUnread,
            };
          });
        }
      } catch (error) {
        const status = Number(error?.response?.status || 0);
        const isTransient = status === 0 || status === 502 || status === 503 || status === 504;
        if (isTransient) {
          const nextFailureCount = Math.min(6, Number(hubPollFailureCountRef.current || 0) + 1);
          hubPollFailureCountRef.current = nextFailureCount;
          hubPollSuppressToastsRef.current = true;
          const backoffMs = Math.min(
            300_000,
            HUB_POLL_INTERVAL_MS * (2 ** Math.max(0, nextFailureCount - 1))
          );
          hubPollBackoffUntilRef.current = Date.now() + backoffMs;

          const now = Date.now();
          if (now - Number(hubPollLastWarnAtRef.current || 0) > 60_000) {
            hubPollLastWarnAtRef.current = now;
            const codeText = status > 0 ? String(status) : 'network';
            console.warn(`Hub notifications poll temporary error (${codeText}), retry in ${Math.ceil(backoffMs / 1000)}s.`);
          }
          return;
        }
        console.error('Hub notifications poll error:', error);
      }
    };

    pollNotificationsRef.current = pollNotifications;
    lastPollRef.current = '';
    hubPollBackoffUntilRef.current = 0;
    hubPollFailureCountRef.current = 0;
    hubPollLastWarnAtRef.current = 0;
    hubPollSuppressToastsRef.current = false;
    fetchUnreadCounts();
    pollNotifications({ forceFull: true, enableToasts: false });
    const timer = setInterval(() => {
      pollNotifications({ forceFull: false, enableToasts: true });
    }, HUB_POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        pollNotifications({ forceFull: false, enableToasts: false });
      }
    };
    const onHubRefresh = () => {
      fetchUnreadCounts();
      pollNotifications({ forceFull: true, enableToasts: false, ignoreBackoff: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hub-refresh-notifications', onHubRefresh);

    const onMailRead = () => {
      setUnreadCounts(prev => {
        const mailUnread = Math.max(0, (prev.mail_unread || 0) - 1);
        const diff = (prev.mail_unread || 0) - mailUnread;
        return {
          ...prev,
          mail_unread: mailUnread,
          notifications_unread_total: Math.max(0, (prev.notifications_unread_total || 0) - diff)
        };
      });
    };
    const onMailListRefreshed = (event) => {
      const nextMailUnread = Math.max(0, Number(event?.detail?.unreadCount || 0));
      setUnreadCounts((prev) => {
        const previousMailUnread = Math.max(0, Number(prev.mail_unread || 0));
        return {
          ...prev,
          mail_unread: nextMailUnread,
          notifications_unread_total: Math.max(
            0,
            Number(prev.notifications_unread_total || 0) - previousMailUnread + nextMailUnread
          ),
        };
      });
    };
    window.addEventListener('mail-read', onMailRead);
    window.addEventListener('mail-list-refreshed', onMailListRefreshed);

    return () => {
      mounted = false;
      pollNotificationsRef.current = null;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hub-refresh-notifications', onHubRefresh);
      window.removeEventListener('mail-read', onMailRead);
      window.removeEventListener('mail-list-refreshed', onMailListRefreshed);
    };
  }, [
    hasDashboardPermission,
    hasMailPermission,
    isMailPage,
  ]);

  const handleDatabaseChange = async (event) => {
    if (dbLocked) return;
    const newDbId = normalizeDbId(event.target.value);
    const selectedDb = databases.find((db) => normalizeDbId(db.id) === newDbId);

    if (selectedDb && newDbId !== normalizeDbId(currentDb?.id)) {
      try {
        await apiClient.post('/database/switch', { database_id: newDbId });
        const selectedId = normalizeDbId(selectedDb.id);
        setCurrentDb({ id: selectedId, name: selectedDb.name });
        localStorage.setItem('selected_database', selectedId);
        window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: selectedId } }));
      } catch (error) {
        console.error('Error switching database:', error);
        notifyApiError(error, 'Ошибка при переключении базы данных.', {
          source: 'database-switch',
        });
      }
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleMarkNotificationRead = async (notificationId) => {
    const id = String(notificationId || '').trim();
    if (!id) return;
    try {
      await apiClient.post(`/hub/notifications/${encodeURIComponent(id)}/read`);
      setNotifications((prev) => (Array.isArray(prev)
        ? prev.map((item) => (String(item?.id || '') === id ? { ...item, unread: 0 } : item))
        : []));
      setUnreadCounts((prev) => ({
        ...(prev || {}),
        notifications_unread_total: Math.max(0, Number(prev?.notifications_unread_total || 0) - 1),
      }));
    } catch (error) {
      console.error('Mark notification read failed:', error);
    }
  };

  const handleOpenNotification = async (item) => {
    if (!item) return;
    const entityType = String(item?.entity_type || '').trim().toLowerCase();
    const entityId = String(item?.entity_id || '').trim();
    if (Number(item?.unread || 0) === 1) {
      await handleMarkNotificationRead(item?.id);
    }
    setNotificationsOpen(false);
    if (entityType === 'task') {
      const suffix = entityId ? `?task=${encodeURIComponent(entityId)}` : '';
      navigate(`/dashboard${suffix}`);
      return;
    }
    if (entityType === 'announcement') {
      const suffix = entityId ? `?announcement=${encodeURIComponent(entityId)}` : '';
      navigate(`/dashboard${suffix}`);
      return;
    }
    navigate('/dashboard');
  };

  const handleNavigation = (item) => {
    const externalUrl = String(item?.externalUrl || '').trim();
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
      setDrawerOpen(false);
      return;
    }
    navigate(item.path);
    setDrawerOpen(false);
  };

  const handleOpenNotifications = () => {
    setNotificationsOpen(true);
    if (typeof pollNotificationsRef.current === 'function') {
      pollNotificationsRef.current({ forceFull: true, enableToasts: false, ignoreBackoff: true });
    }
  };

  const isItemActive = (path) => {
    if (path === '/networks') {
      return location.pathname === '/networks' || location.pathname.startsWith('/networks/');
    }
    return location.pathname === path;
  };

  const getCurrentTitle = () => {
    const item = visibleNavigationItems.find((item) => isItemActive(item.path));
    return item ? item.label : 'IT-invent Web';
  };
  const currentTitle = getCurrentTitle();
  const currentDbName = String(currentDb?.name || 'База данных').trim() || 'База данных';

  const notificationSections = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    const groups = { today: [], yesterday: [], earlier: [] };

    notifications.forEach((item) => {
      const parsed = new Date(item?.created_at || '');
      if (parsed.toDateString() === todayStr) groups.today.push(item);
      else if (parsed.toDateString() === yesterdayStr) groups.yesterday.push(item);
      else groups.earlier.push(item);
    });

    return [
      { key: 'today', label: 'Сегодня', items: groups.today },
      { key: 'yesterday', label: 'Вчера', items: groups.yesterday },
      { key: 'earlier', label: 'Ранее', items: groups.earlier },
    ].filter((section) => section.items.length > 0);
  }, [notifications]);

  const toastHistoryItems = useMemo(
    () => toastHistory.slice(0, 12),
    [toastHistory],
  );

  const drawerContent = (
    <Box sx={{ height: '100%', bgcolor: ui.navBg }}>
      <Toolbar sx={{ minHeight: 'var(--app-shell-header-offset) !important' }} />
      <List sx={{ px: 1, pt: 0.75 }}>
        {visibleNavigationItems.map((item) => (
          <ListItem key={item.path} disablePadding sx={{ px: 0.5, py: 0.2 }}>
            <ListItemButton
              selected={!item.externalUrl && isItemActive(item.path)}
              onClick={() => handleNavigation(item)}
              sx={() => {
                const selected = !item.externalUrl && isItemActive(item.path);
                return {
                  minHeight: 44,
                  px: 1.35,
                  borderRadius: 2.25,
                  color: selected ? theme.palette.text.primary : ui.iconPrimary,
                  transition: theme.transitions.create(['background-color', 'color', 'border-color'], {
                    duration: theme.transitions.duration.shorter,
                  }),
                  border: '1px solid',
                  borderColor: selected ? ui.selectedBorder : 'transparent',
                  backgroundColor: selected ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.07) : 'transparent',
                  '& .MuiListItemIcon-root': {
                    minWidth: 38,
                    color: selected ? theme.palette.primary.main : ui.iconMuted,
                  },
                  '& .MuiListItemText-primary': {
                    fontWeight: selected ? 700 : 600,
                    color: selected ? theme.palette.text.primary : ui.iconPrimary,
                  },
                  '&:hover': {
                    backgroundColor: selected ? ui.selectedBg : ui.actionHover,
                    borderColor: selected ? ui.selectedBorder : ui.actionBorder,
                    '& .MuiListItemIcon-root': {
                      color: selected ? theme.palette.primary.main : ui.iconPrimary,
                    },
                  },
                };
              }}
            >
              <ListItemIcon>
                {item.path === '/tasks' && Number(unreadCounts?.tasks_open || 0) > 0 ? (
                  <Badge color="error" badgeContent={Number(unreadCounts?.tasks_open || 0)}>
                    {item.icon}
                  </Badge>
                ) : item.path === '/mail' && Number(unreadCounts?.mail_unread || 0) > 0 ? (
                  <Badge color="error" badgeContent={Number(unreadCounts?.mail_unread || 0)}>
                    {item.icon}
                  </Badge>
                ) : item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      <Divider sx={{ borderColor: ui.borderSoft }} />
    </Box>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100dvh',
        bgcolor: ui.pageBg,
        '--app-shell-header-offset': {
          xs: '56px',
          sm: '64px',
        },
      }}
    >
      {/* AppBar */}
      <AppBar
        position="fixed"
        sx={{
          bgcolor: alpha(ui.shellBg, theme.palette.mode === 'dark' ? 0.94 : 0.9),
          color: theme.palette.text.primary,
          boxShadow: 'none',
          borderBottom: '1px solid',
          borderColor: ui.borderSoft,
          backdropFilter: 'blur(18px)',
          width: { sm: sidebarCollapsed ? '100%' : `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { sm: sidebarCollapsed ? 0 : `${DRAWER_WIDTH}px` },
          transition: (theme) => theme.transitions.create(['width', 'margin'], {
            duration: theme.transitions.duration.standard,
          }),
        }}
      >
        <Toolbar sx={{ minHeight: 'var(--app-shell-header-offset) !important' }}>
          <IconButton
            edge="start"
            onClick={() => {
              if (window.innerWidth < 600) {
                setDrawerOpen(!drawerOpen);
              } else {
                toggleSidebar();
              }
            }}
            sx={{
              mr: 2,
              ...getOfficeQuietActionSx(ui, theme, 'neutral', {
                borderColor: 'transparent',
                bgcolor: 'transparent',
              }),
              '& .MuiSvgIcon-root': {
                transition: (theme) => theme.transitions.create('transform', {
                  duration: theme.transitions.duration.standard,
                }),
                transform: sidebarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
              },
            }}
          >
            <MenuIcon />
          </IconButton>
          <Stack direction="row" spacing={1.2} alignItems="center" sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box
              sx={{
                px: 1.35,
                py: 0.7,
                borderRadius: 2.6,
                bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08),
                border: '1px solid',
                borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.14),
                boxShadow: 'none',
                flexShrink: 0,
              }}
            >
              <Typography sx={{ fontWeight: 900, letterSpacing: '0.04em', fontSize: '0.9rem', lineHeight: 1, color: theme.palette.primary.main }}>
                ITINVENT
              </Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ display: 'block', color: ui.subtleText, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.1 }}>
                Рабочая область
              </Typography>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.25 }}>
                {currentTitle}
              </Typography>
            </Box>
          </Stack>
          {showNotificationsButton ? (
            <IconButton onClick={handleOpenNotifications} sx={{ mr: 1, ...getOfficeQuietActionSx(ui, theme) }}>
              <Badge color="error" badgeContent={notificationsBadgeValue}>
                <NotificationsIcon />
              </Badge>
            </IconButton>
          ) : null}
          <Typography variant="body2" sx={{ mr: 1.5, color: ui.mutedText, fontWeight: 600, display: { xs: 'none', md: 'block' } }}>
            {user?.username}
          </Typography>
          <FormControl size="small" sx={{ mr: 1.5, minWidth: { xs: 132, sm: 180 } }}>
            <Select
              value={normalizeDbId(currentDb?.id)}
              onChange={handleDatabaseChange}
              disabled={dbLocked}
              displayEmpty
              renderValue={() => (
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  <Chip
                    label={currentDbName}
                    size="small"
                    sx={{
                      maxWidth: { xs: 92, sm: 132 },
                      height: 24,
                      borderRadius: 999,
                      border: 'none',
                      bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.10),
                      color: theme.palette.primary.main,
                      '& .MuiChip-label': {
                        px: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }}
                  />
                  <Typography variant="caption" sx={{ color: ui.subtleText, display: { xs: 'none', sm: 'block' } }}>
                    База
                  </Typography>
                </Stack>
              )}
              sx={{
                color: theme.palette.text.primary,
                bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.04),
                borderRadius: '12px',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.10),
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: ui.selectedBorder,
                },
                '& .MuiSelect-icon': {
                  color: ui.iconPrimary,
                },
              }}
            >
              {databases.map((db) => (
                <MenuItem key={normalizeDbId(db.id)} value={normalizeDbId(db.id)}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <span>{db.name}</span>
                    {normalizeDbId(db.id) === normalizeDbId(currentDb?.id) && (
                      <Chip label="Текущая" size="small" color="success" sx={{ ml: 1, height: 20, fontSize: '0.7rem', border: 'none' }} />
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {dbLocked && (
            <Chip
              label="БД закреплена"
              size="small"
              color="warning"
              sx={{ mr: 2, border: 'none' }}
            />
          )}
          <Button
            color="inherit"
            variant="outlined"
            onClick={handleLogout}
            startIcon={<LogoutIcon />}
            sx={getOfficeQuietActionSx(ui, theme)}
          >
            Выход
          </Button>
        </Toolbar>
      </AppBar>

      {/* Sidebar Drawer */}
      <Box
        component="nav"
        sx={{
          width: { sm: sidebarCollapsed ? 0 : DRAWER_WIDTH },
          flexShrink: { sm: 0 },
          transition: (theme) => theme.transitions.create('width', {
            duration: theme.transitions.duration.standard,
          }),
        }}
      >
        <Drawer
          variant="temporary"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH, bgcolor: ui.navBg, borderRightColor: ui.borderSoft },
          }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: sidebarCollapsed ? 'none' : 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH, bgcolor: ui.navBg, borderRightColor: ui.borderSoft },
            transition: (theme) => theme.transitions.create('display', {
              duration: theme.transitions.duration.standard,
            }),
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          px: { xs: 2, md: 3 },
          pb: { xs: 2, md: 3 },
          pt: { xs: 2, md: 3 },
          bgcolor: ui.pageBg,
          width: {
            xs: '100%',
            sm: sidebarCollapsed ? '100%' : `calc(100% - ${DRAWER_WIDTH}px)`
          },
          transition: (theme) => theme.transitions.create(['width', 'margin'], {
            duration: theme.transitions.duration.standard,
          }),
        }}
      >
        <Toolbar sx={{ minHeight: 'var(--app-shell-header-offset) !important', px: 0 }} />
        {children}
      </Box>

      <Drawer
        anchor="right"
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        PaperProps={{ sx: { bgcolor: ui.navBg, borderLeft: '1px solid', borderColor: ui.borderSoft, boxShadow: ui.dialogShadow } }}
      >
        <Box sx={{ width: { xs: 340, sm: 400 }, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Header */}
          <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.headerBandBg }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle1" sx={{ fontWeight: 800, fontSize: '1.05rem' }}>Уведомления</Typography>
                {Number(unreadCounts?.notifications_unread_total || 0) > 0 && (
                  <Chip size="small" label={unreadCounts.notifications_unread_total}
                    sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: ui.selectedBg, color: 'primary.main', border: 'none' }} />
                )}
              </Stack>
              <Stack direction="row" spacing={0.75}>
                {toastHistoryItems.length > 0 && (
                  <Button
                    size="small"
                    onClick={clearToastHistory}
                    sx={{ textTransform: 'none', fontSize: '0.72rem', fontWeight: 600 }}
                  >
                    Очистить журнал
                  </Button>
                )}
                {Number(unreadCounts?.notifications_unread_total || 0) > 0 && (
                  <Button size="small" onClick={async () => {
                    const unreadItems = (Array.isArray(notifications) ? notifications : []).filter((i) => Number(i?.unread || 0) === 1);
                    for (const item of unreadItems) {
                      try { await apiClient.post(`/hub/notifications/${encodeURIComponent(item.id)}/read`); } catch { }
                    }
                    setNotifications((prev) => (Array.isArray(prev) ? prev.map((i) => ({ ...i, unread: 0 })) : []));
                    setUnreadCounts((prev) => ({ ...(prev || {}), notifications_unread_total: 0 }));
                  }}
                    sx={{ textTransform: 'none', fontSize: '0.72rem', fontWeight: 600 }}>
                    Прочитать все
                  </Button>
                )}
              </Stack>
            </Stack>
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
            {notificationSections.length === 0 && toastHistoryItems.length === 0 ? (
              <Box sx={{ ...getOfficeEmptyStateSx(ui, { textAlign: 'center', py: 6 }) }}>
                <NotificationsNoneIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>Нет уведомлений и системных событий</Typography>
              </Box>
            ) : (
              <>
                {notificationSections.length > 0 ? notificationSections.map((section) => (
                <Box key={section.key} sx={{ mb: 2 }}>
                  <Typography variant="overline" sx={{ color: 'text.disabled', fontWeight: 700, fontSize: '0.6rem', letterSpacing: '0.1em', display: 'block', mb: 0.8, px: 0.5 }}>
                    {section.label}
                  </Typography>
                  <Stack spacing={0.5}>
                    {section.items.map((item) => {
                      const unread = Number(item?.unread || 0) === 1;
                      const entityType = String(item?.entity_type || '').toLowerCase();
                      const isTask = entityType === 'task';
                      const accentColor = isTask ? '#f59e0b' : '#3b82f6';
                      return (
                        <Box key={item.id} sx={{
                          ...getOfficePanelSx(ui, {
                            p: 1.2,
                            borderRadius: '12px',
                            cursor: 'pointer',
                            bgcolor: unread ? alpha(accentColor, theme.palette.mode === 'dark' ? 0.12 : 0.08) : ui.panelSolid,
                            borderColor: unread ? alpha(accentColor, theme.palette.mode === 'dark' ? 0.26 : 0.16) : ui.borderSoft,
                            transition: 'all 0.15s ease',
                            '&:hover': { bgcolor: unread ? alpha(accentColor, theme.palette.mode === 'dark' ? 0.16 : 0.10) : ui.actionHover, borderColor: unread ? alpha(accentColor, theme.palette.mode === 'dark' ? 0.34 : 0.22) : ui.borderStrong },
                          }),
                        }}
                          onClick={() => handleOpenNotification(item)}
                        >
                          <Stack direction="row" spacing={1} alignItems="flex-start">
                            <Box sx={{
                              width: 32, height: 32, borderRadius: '10px', flexShrink: 0, mt: 0.2,
                              bgcolor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.18 : 0.10), display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {isTask
                                ? <AssignmentIcon sx={{ fontSize: 16, color: accentColor }} />
                                : <NotificationsNoneIcon sx={{ fontSize: 16, color: accentColor }} />
                              }
                            </Box>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="body2" sx={{
                                  fontWeight: unread ? 700 : 500, fontSize: '0.82rem', lineHeight: 1.3,
                                  color: 'text.primary',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {item?.title || 'Уведомление'}
                                </Typography>
                                {unread && (
                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: accentColor, flexShrink: 0, ml: 1 }} />
                                )}
                              </Stack>
                              {item?.body && (
                                <Typography variant="caption" sx={{
                                  color: 'text.secondary', display: 'block', mt: 0.3, fontSize: '0.72rem', lineHeight: 1.3,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>{item.body}</Typography>
                              )}
                              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
                                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
                                  {item?.created_at ? new Date(item.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '-'}
                                </Typography>
                                {unread && (
                                  <Button size="small" onClick={(e) => { e.stopPropagation(); handleMarkNotificationRead(item.id); }}
                                    sx={{ textTransform: 'none', fontSize: '0.62rem', fontWeight: 600, minWidth: 0, py: 0, px: 0.5 }}>
                                    Прочитано
                                  </Button>
                                )}
                              </Stack>
                            </Box>
                          </Stack>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
                )) : (
                  <Box sx={{ ...getOfficeEmptyStateSx(ui, { mb: 2.2, textAlign: 'center', py: 3.5 }) }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Нет уведомлений центра управления.
                    </Typography>
                  </Box>
                )}

                {toastHistoryItems.length > 0 ? (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Box sx={{ mb: 1.2 }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.4, mb: 1 }}>
                        <HistoryRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography
                          variant="overline"
                          sx={{ color: 'text.disabled', fontWeight: 700, fontSize: '0.6rem', letterSpacing: '0.1em' }}
                        >
                          Системные события
                        </Typography>
                      </Stack>
                      <Stack spacing={0.75}>
                        {toastHistoryItems.map((item) => {
                          const severityMeta = TOAST_SEVERITY_META[item?.severity] || TOAST_SEVERITY_META.info;
                          const SeverityIcon = severityMeta.icon;
                          const sourceLabel = TOAST_SOURCE_LABELS[item?.source] || 'Система';
                          const title = String(item?.title || '').trim() || sourceLabel;
                          const message = String(item?.message || '').trim();
                          const duplicated = title === message;

                          return (
                            <Box
                              key={item.id}
                              sx={{
                                p: 1.2,
                                borderRadius: '12px',
                                border: '1px solid',
                                borderColor: alpha(severityMeta.color, 0.18),
                                bgcolor: alpha(severityMeta.color, 0.06),
                              }}
                            >
                              <Stack direction="row" spacing={1} alignItems="flex-start">
                                <Box
                                  sx={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: '10px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    bgcolor: alpha(severityMeta.color, 0.14),
                                    color: severityMeta.color,
                                  }}
                                >
                                  <SeverityIcon sx={{ fontSize: 16 }} />
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontWeight: 700,
                                        lineHeight: 1.3,
                                        color: 'text.primary',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {title}
                                    </Typography>
                                    {Number(item?.repeatCount || 1) > 1 && (
                                      <Chip
                                        size="small"
                                        label={`x${item.repeatCount}`}
                                        sx={{
                                          height: 20,
                                          fontSize: '0.65rem',
                                          fontWeight: 700,
                                          color: severityMeta.color,
                                          bgcolor: alpha(severityMeta.color, 0.14),
                                        }}
                                      />
                                    )}
                                  </Stack>
                                  {!duplicated && (
                                    <Typography
                                      variant="caption"
                                      sx={{
                                        display: 'block',
                                        mt: 0.25,
                                        color: 'text.secondary',
                                        fontSize: '0.72rem',
                                        lineHeight: 1.35,
                                      }}
                                    >
                                      {message}
                                    </Typography>
                                  )}
                                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.65 }}>
                                    <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                                      <Chip
                                        size="small"
                                        label={sourceLabel}
                                        sx={{
                                          height: 20,
                                          fontSize: '0.62rem',
                                          fontWeight: 600,
                                          bgcolor: ui.actionBg,
                                          border: '1px solid',
                                          borderColor: ui.borderSoft,
                                        }}
                                      />
                                      {Number(item?.statusCode || 0) > 0 && (
                                        <Chip
                                          size="small"
                                          label={`HTTP ${item.statusCode}`}
                                          sx={{
                                            height: 20,
                                            fontSize: '0.62rem',
                                            fontWeight: 600,
                                            bgcolor: ui.actionBg,
                                            border: '1px solid',
                                            borderColor: ui.borderSoft,
                                          }}
                                        />
                                      )}
                                      {Number(item?.suppressedCount || 0) > 0 && (
                                        <Chip
                                          size="small"
                                          label={`Подавлено: ${item.suppressedCount}`}
                                          sx={{
                                            height: 20,
                                            fontSize: '0.62rem',
                                            fontWeight: 600,
                                            color: severityMeta.color,
                                            bgcolor: alpha(severityMeta.color, 0.1),
                                          }}
                                        />
                                      )}
                                    </Stack>
                                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
                                      {formatPanelDateTime(item?.lastSeenAt)}
                                    </Typography>
                                  </Stack>
                                </Box>
                              </Stack>
                            </Box>
                          );
                        })}
                      </Stack>
                    </Box>
                  </>
                ) : null}
              </>
            )}
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}

export default MainLayout;
