/**
 * Main Layout component - AppBar and Sidebar navigation.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Badge,
  BottomNavigation,
  BottomNavigationAction,
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
  CircularProgress,
  Collapse,
  Menu,
  Tooltip,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
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
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import AssignmentIcon from '@mui/icons-material/Assignment';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import GroupIcon from '@mui/icons-material/Group';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import VideocamIcon from '@mui/icons-material/Videocam';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import apiClient, { chatAPI, mailAPI, settingsAPI } from '../../api/client';
import { databaseAPI } from '../../api/database';
import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { buildOfficeUiTokens, getOfficeEmptyStateSx, getOfficePanelSx, getOfficeQuietActionSx } from '../../theme/officeUiTokens';
import BrandedRouteLoader from './BrandedRouteLoader';
import {
  TOAST_ACTION_EXECUTE_EVENT,
  createNavigateToastAction,
  normalizeToastAction,
} from '../feedback/toastActions';
import {
  autoEnableWindowsNotificationsIfGranted,
  createHubSystemNotification,
  createMailSystemNotification,
  getMailNotificationDisplay,
  getMailSystemNotificationId,
  getHubNotificationActionLabel,
  getHubNotificationNavigateTo,
  getWindowsNotificationState,
  hasShownMailSystemNotification,
  markMailSystemNotificationShown,
  requestBrowserNotificationPermission,
  setWindowsNotificationsEnabled,
  WINDOWS_NOTIFICATIONS_CHANGED_EVENT,
} from '../../lib/windowsNotifications';
import {
  chatSocket,
  CHAT_SOCKET_MESSAGE_CREATED_EVENT,
  CHAT_SOCKET_STATUS_EVENT,
  CHAT_SOCKET_UNREAD_SUMMARY_EVENT,
} from '../../lib/chatSocket';
import {
  buildChatNotificationRoute,
  claimChatMessageNotification,
  createChatSystemNotification,
  getChatNotificationState,
  refreshChatNotificationState,
  setChatForegroundDiagnostic,
  setChatSocketStatus,
  shouldDeliverExternalChatViaPushOnly,
  shouldSkipChatPushForegroundNotification,
  syncChatPushSubscription,
} from '../../lib/chatNotifications';
import { emitAgentDebugLog } from '../../lib/debugClientLog';
import { hasAnyAppPushPermission } from '../../lib/appPushPermissions';
import { syncAppBadge } from '../../lib/appBadge';
import { applyPwaUpdate, getPwaInstallState, subscribePwaInstallState } from '../../lib/pwaInstall';
import { prefetchRouteByPath } from '../../lib/routeLoaders';
import { getMessagePreview } from '../chat/chatHelpers';
import { MainLayoutShellContext } from './MainLayoutShellContext';
import { APP_BRAND_NAME, buildDocumentTitle } from '../../lib/appBranding';
import { AccountAvatar, AccountIdentity } from '../account/AccountIdentity';
import { canAccessAdminArea } from '../account/accountNavigationConfig';
import {
  getNavigationBadgeCount,
  getVisibleNavigationItems,
  isNavigationItemActive,
  navigationItems,
  resolveMobileNavigationItems,
} from './navigationConfig';

const DRAWER_WIDTH_CSS_VAR = 'var(--app-density-drawer-width)';
const DRAWER_RAIL_WIDTH = 68;
const HUB_POLL_INTERVAL_MS = 20_000;
const PWA_BADGE_POLL_INTERVAL_MS = 60_000;
const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed';
const SIDEBAR_TOOLS_EXPANDED_KEY = 'sidebar_tools_expanded';
const normalizeDbId = (value) => String(value ?? '').trim();
const MAIL_LOCAL_DEDUPE_WINDOW_MS = 30_000;
const MAIL_ROUTE_UNREAD_REFRESH_TTL_MS = 120_000;
const PUSH_FOREGROUND_NOTIFICATION_EVENT = 'itinvent:push-foreground-notification';

const groupItemsByRelativeDate = (items, dateKey) => {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  const groups = { today: [], yesterday: [], earlier: [] };

  (Array.isArray(items) ? items : []).forEach((item) => {
    const rawValue = String(item?.[dateKey] || '').trim();
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      groups.earlier.push(item);
      return;
    }
    if (parsed.toDateString() === todayStr) groups.today.push(item);
    else if (parsed.toDateString() === yesterdayStr) groups.yesterday.push(item);
    else groups.earlier.push(item);
  });

  return [
    { key: 'today', label: 'Сегодня', items: groups.today },
    { key: 'yesterday', label: 'Вчера', items: groups.yesterday },
    { key: 'earlier', label: 'Ранее', items: groups.earlier },
  ].filter((section) => section.items.length > 0);
};

function MainLayout({
  children,
  headerMode = 'default',
  contentMode = 'default',
  mobileBottomNavMode = 'auto',
  mobileBottomNavTransitionMs = 280,
  showDatabaseSelector = false,
  headerInlineContent = null,
}) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: true });
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return saved === 'true';
  });
  const [sidebarToolsExpanded, setSidebarToolsExpanded] = useState(() => (
    localStorage.getItem(SIDEBAR_TOOLS_EXPANDED_KEY) !== 'false'
  ));
  const [accountMenuAnchorEl, setAccountMenuAnchorEl] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const {
    notifyApiError,
    notifyInfo,
    notifyWarning,
    hasSeenHubNotification,
    markHubNotificationsSeen,
  } = useNotification();
  const [databases, setDatabases] = useState([]);
  const [currentDb, setCurrentDb] = useState(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbLocked, setDbLocked] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [mailNotifications, setMailNotifications] = useState([]);
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
    chat_messages_unread_total: 0,
    chat_conversations_unread: 0,
    mail_unread: 0,
  });
  const [windowsNotificationState, setWindowsNotificationState] = useState(() => getWindowsNotificationState());
  const [pwaState, setPwaState] = useState(() => getPwaInstallState());
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));
  const [notificationPermissionBannerDismissed, setNotificationPermissionBannerDismissed] = useState(false);
  const topBannerRef = useRef(null);
  const appBarRef = useRef(null);
  const [topBannerOffset, setTopBannerOffset] = useState(0);
  const [appBarHeight, setAppBarHeight] = useState(0);
  const notificationsOpenRef = useRef(false);
  const pendingNavigationTimerRef = useRef(null);
  const pendingNavigationTimeoutRef = useRef(null);
  const unreadCountsRef = useRef(unreadCounts);
  const databaseMetaLoadedRef = useRef(false);
  const lastPollRef = useRef('');
  const pollNotificationsRef = useRef(null);
  const fetchUnreadCountsRef = useRef(null);
  const fetchUnreadCountsInFlightRef = useRef(null);
  const refreshBellInboxRef = useRef(null);
  const hubPollBackoffUntilRef = useRef(0);
  const hubPollFailureCountRef = useRef(0);
  const hubPollLastWarnAtRef = useRef(0);
  const hubPollSuppressToastsRef = useRef(false);
  const hasSeenHubNotificationRef = useRef(hasSeenHubNotification);
  const markHubNotificationsSeenRef = useRef(markHubNotificationsSeen);
  const notifyInfoRef = useRef(notifyInfo);
  const windowsNotificationStateRef = useRef(windowsNotificationState);
  const recentMailNotificationIdsRef = useRef(new Map());
  const chatUnreadSummaryRef = useRef({
    messages_unread_total: 0,
    conversations_unread: 0,
  });
  const mailUnreadFetchedAtRef = useRef(0);
  const mailUnreadBaselineReadyRef = useRef(false);
  const mailChannelEnabledRef = useRef(true);
  const hasDashboardPermission = hasPermission('dashboard.read');
  const hasTasksPermission = hasPermission('tasks.read');
  const hasChatPermission = CHAT_FEATURE_ENABLED && hasPermission('chat.read');
  const hasMailPermission = hasPermission('mail.access');
  const hasHubNotificationPermission = hasDashboardPermission || hasTasksPermission || hasChatPermission;
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const showAdminArea = canAccessAdminArea({ user, hasPermission });
  const activeChatConversationIdFromUrl = useMemo(
    () => String(new URLSearchParams(location.search).get('conversation') || '').trim(),
    [location.search],
  );
  const [activeChatConversationIdFromChat, setActiveChatConversationIdFromChat] = useState('');
  useEffect(() => {
    const handleActiveConversationChanged = (event) => {
      setActiveChatConversationIdFromChat(String(event?.detail?.conversationId || '').trim());
    };
    window.addEventListener('chat-active-conversation-changed', handleActiveConversationChanged);
    return () => {
      window.removeEventListener('chat-active-conversation-changed', handleActiveConversationChanged);
    };
  }, []);
  const activeChatConversationId = activeChatConversationIdFromChat || activeChatConversationIdFromUrl;
  const isChatRoute = location.pathname.startsWith('/chat');
  const isMailRoute = location.pathname.startsWith('/mail');
  const isFixedHeightRoute = isChatRoute || isMailRoute;
  const isMobileChatRoute = isPhone && isChatRoute;
  const isDesktopChatRoute = !isPhone && isChatRoute;
  const isEdgeToEdgeMobileContent = isPhone && contentMode === 'edge-to-edge-mobile';
  const notificationsOnlyHeader = headerMode === 'notifications-only';
  const hiddenHeader = headerMode === 'hidden' || isPhone;
  const minimalHeader = isPhone && headerMode === 'minimal';
  const unreadHubNotificationCount = useMemo(
    () => (
      Array.isArray(notifications)
        ? notifications.reduce(
            (sum, item) => sum + (Number(item?.unread || 0) === 1 ? 1 : 0),
            0,
          )
        : 0
    ),
    [notifications],
  );
  const unreadMailNotificationCount = useMemo(
    () => (
      Array.isArray(mailNotifications)
        ? mailNotifications.reduce(
            (sum, item) => sum + (!Boolean(item?.is_read) ? 1 : 0),
            0,
          )
        : 0
    ),
    [mailNotifications],
  );
  const unreadBellInboxCount = unreadHubNotificationCount + unreadMailNotificationCount;
  const visibleNavigationItems = getVisibleNavigationItems({ user, hasPermission });
  const mainNavigationItems = useMemo(
    () => visibleNavigationItems.filter((item) => item.group === 'main'),
    [visibleNavigationItems],
  );
  const toolNavigationItems = useMemo(
    () => visibleNavigationItems.filter((item) => item.group === 'tools'),
    [visibleNavigationItems],
  );
  const visibleMobileNavigationItems = useMemo(
    () => resolveMobileNavigationItems({
      selectedPaths: preferences.mobile_bottom_nav_items,
      user,
      hasPermission,
    }),
    [hasPermission, preferences.mobile_bottom_nav_items, user],
  );
  const showMobileBottomNavigation = Boolean(
    isPhone
    && mobileBottomNavMode !== 'hidden'
    && visibleMobileNavigationItems.length > 0
  );
  const hasMobileBottomNavigation = Boolean(
    isPhone && visibleMobileNavigationItems.length > 0
  );
  const mobileBottomNavHidden = mobileBottomNavMode === 'hidden';
  const mobileBottomNavTransition = useMemo(
    () => theme.transitions.create(['padding-bottom', 'transform'], {
      duration: mobileBottomNavTransitionMs,
      easing: theme.transitions.easing.easeInOut,
    }),
    [mobileBottomNavTransitionMs, theme.transitions],
  );
  const showNotificationsButton = hasHubNotificationPermission || hasMailPermission;
  const notificationsBadgeValue = Number(unreadCounts?.notifications_unread_total || 0);
  const appBadgeValue = Number(unreadCounts?.notifications_unread_total || 0);
  const showNotificationPermissionBanner = Boolean(
    windowsNotificationState?.supported
    && windowsNotificationState?.permission === 'default'
    && !notificationPermissionBannerDismissed
  );
  const showOfflineBanner = Boolean(isOffline);
  const showPwaUpdateBanner = Boolean(pwaState?.updateAvailable);
  const isStandaloneShell = Boolean(pwaState?.installed);
  const isWindowControlsOverlay = Boolean(
    pwaState?.displayMode === 'window-controls-overlay' || pwaState?.windowControlsOverlayVisible,
  );

  useEffect(() => {
    hasSeenHubNotificationRef.current = hasSeenHubNotification;
  }, [hasSeenHubNotification]);

  useEffect(() => {
    markHubNotificationsSeenRef.current = markHubNotificationsSeen;
  }, [markHubNotificationsSeen]);

  useEffect(() => {
    notifyInfoRef.current = notifyInfo;
  }, [notifyInfo]);

  useEffect(() => {
    windowsNotificationStateRef.current = windowsNotificationState;
  }, [windowsNotificationState]);

  useEffect(() => {
    if (windowsNotificationState?.permission !== 'default' && notificationPermissionBannerDismissed) {
      setNotificationPermissionBannerDismissed(false);
    }
  }, [notificationPermissionBannerDismissed, windowsNotificationState?.permission]);

  useEffect(() => {
    notificationsOpenRef.current = notificationsOpen;
  }, [notificationsOpen]);

  useEffect(() => {
    unreadCountsRef.current = unreadCounts;
  }, [unreadCounts]);

  useEffect(() => subscribePwaInstallState(setPwaState), []);

  useEffect(() => () => {
    if (pendingNavigationTimerRef.current) {
      window.clearTimeout(pendingNavigationTimerRef.current);
      pendingNavigationTimerRef.current = null;
    }
    if (pendingNavigationTimeoutRef.current) {
      window.clearTimeout(pendingNavigationTimeoutRef.current);
      pendingNavigationTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!pendingNavigation) return;
    const normalizedTargetPath = String(pendingNavigation?.path || '').trim();
    if (!normalizedTargetPath) {
      setPendingNavigation(null);
      return;
    }
    if (normalizedTargetPath === '/networks') {
      if (location.pathname === '/networks' || location.pathname.startsWith('/networks/')) {
        setPendingNavigation(null);
      }
      return;
    }
    if (location.pathname === normalizedTargetPath) {
      setPendingNavigation(null);
    }
  }, [location.pathname, pendingNavigation]);

  useEffect(() => {
    const syncOnlineState = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', syncOnlineState);
    window.addEventListener('offline', syncOnlineState);
    return () => {
      window.removeEventListener('online', syncOnlineState);
      window.removeEventListener('offline', syncOnlineState);
    };
  }, []);

  useEffect(() => {
    const updateBannerOffset = () => {
      setTopBannerOffset(Math.ceil(topBannerRef.current?.getBoundingClientRect?.().height || 0));
    };
    updateBannerOffset();
    if (typeof ResizeObserver !== 'function' || !topBannerRef.current) {
      window.addEventListener('resize', updateBannerOffset);
      return () => window.removeEventListener('resize', updateBannerOffset);
    }
    const observer = new ResizeObserver(updateBannerOffset);
    observer.observe(topBannerRef.current);
    window.addEventListener('resize', updateBannerOffset);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBannerOffset);
    };
  }, [showNotificationPermissionBanner, showOfflineBanner, showPwaUpdateBanner]);

  useEffect(() => {
    if (hiddenHeader) {
      setAppBarHeight(0);
      return undefined;
    }

    const updateAppBarHeight = () => {
      const nextHeight = Math.ceil(appBarRef.current?.getBoundingClientRect?.().height || 0);
      setAppBarHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };
    updateAppBarHeight();
    if (typeof ResizeObserver !== 'function' || !appBarRef.current) {
      window.addEventListener('resize', updateAppBarHeight);
      return () => window.removeEventListener('resize', updateAppBarHeight);
    }
    const observer = new ResizeObserver(updateAppBarHeight);
    observer.observe(appBarRef.current);
    window.addEventListener('resize', updateAppBarHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateAppBarHeight);
    };
  }, [
    hiddenHeader,
    isWindowControlsOverlay,
    isStandaloneShell,
    headerMode,
    isPhone,
    sidebarCollapsed,
  ]);

  useEffect(() => {
    void syncAppBadge(appBadgeValue);
  }, [appBadgeValue]);

  useEffect(() => {
    if (!isStandaloneShell) return undefined;
    if (!hasHubNotificationPermission && !hasMailPermission) return undefined;

    const syncBackgroundBadge = () => {
      if (document.visibilityState === 'visible') return;
      fetchUnreadCountsRef.current?.(null, {
        reason: 'pwa-badge-background',
        forceMailUnread: hasMailPermission,
      });
    };

    syncBackgroundBadge();
    const timer = window.setInterval(syncBackgroundBadge, PWA_BADGE_POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        syncBackgroundBadge();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    hasHubNotificationPermission,
    hasMailPermission,
    isStandaloneShell,
  ]);

  const rememberRecentMailNotification = useCallback((messageId) => {
    const normalizedId = String(messageId || '').trim();
    if (!normalizedId) return false;
    const now = Date.now();
    const recent = recentMailNotificationIdsRef.current || new Map();
    for (const [id, seenAt] of recent.entries()) {
      if ((now - Number(seenAt || 0)) > MAIL_LOCAL_DEDUPE_WINDOW_MS) {
        recent.delete(id);
      }
    }
    if (recent.has(normalizedId)) {
      recentMailNotificationIdsRef.current = recent;
      return false;
    }
    recent.set(normalizedId, now);
    if (recent.size > 100) {
      const recentIds = [...recent.entries()]
        .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
        .slice(0, 100);
      recentMailNotificationIdsRef.current = new Map(recentIds);
      return true;
    }
    recentMailNotificationIdsRef.current = recent;
    return true;
  }, []);

  const showForegroundPushToast = useCallback((detail = {}) => {
    const channel = String(detail?.channel || '').trim().toLowerCase() || 'system';
    const data = detail?.data && typeof detail.data === 'object' ? detail.data : {};
    const route = String(detail?.route || data?.route || '/').trim() || '/';
    const title = String(detail?.title || '').trim();
    const body = String(detail?.body || '').trim();

    if (channel === 'chat') {
      const conversationId = String(data?.conversation_id || '').trim();
      const messageId = String(data?.message_id || '').trim();
      const pushTag = String(detail?.tag || '').trim();
      const dedupeKey = `chat:${messageId || pushTag || conversationId}`;
      const skipBecauseSocketConnected = shouldSkipChatPushForegroundNotification();
      if (skipBecauseSocketConnected) {
        setChatForegroundDiagnostic('chat_socket_connected');
        return;
      }
      const navigateTo = route !== '/'
        ? route
        : buildChatNotificationRoute({ conversationId, messageId });
      if (isMobileChatRoute && document.visibilityState === 'visible') {
        setChatForegroundDiagnostic('mobile_chat_route_visible');
        return;
      }
      const isActiveVisibleConversation = (
        location.pathname.startsWith('/chat')
        && activeChatConversationId === conversationId
        && document.visibilityState === 'visible'
      );
      if (isActiveVisibleConversation) {
        setChatForegroundDiagnostic('active_visible_conversation');
        return;
      }
      if (!claimChatMessageNotification(messageId)) {
        return;
      }
      notifyInfoRef.current?.(body || title || 'Новое сообщение', {
        title: title || 'Собеседник',
        source: 'chat',
        channel: 'system',
        dedupeMode: 'recent',
        dedupeKey,
        action: createNavigateToastAction(navigateTo, 'Открыть чат'),
        durationMs: 5200,
      });
      return;
    }

    if (channel === 'mail') {
      const messageId = String(data?.message_id || '').trim();
      notifyInfoRef.current?.(body || title || 'Новое письмо', {
        title: title || 'Почта',
        source: 'mail',
        channel: 'system',
        dedupeMode: 'recent',
        dedupeKey: `mail:${messageId || String(detail?.tag || '').trim() || route}`,
        action: createNavigateToastAction(route, 'Открыть письмо'),
        durationMs: 5200,
      });
      return;
    }

    const notificationId = String(data?.notification_id || '').trim();
    const actionLabel = channel === 'tasks'
      ? 'Открыть задачу'
      : channel === 'announcements'
        ? 'Открыть заметку'
        : 'Открыть';
    notifyInfoRef.current?.(body || title || 'Новое уведомление', {
      title: title || 'Уведомление',
      source: 'hub',
      channel: 'system',
      dedupeMode: 'recent',
      dedupeKey: `hub:${notificationId || String(detail?.tag || '').trim() || route}`,
      action: createNavigateToastAction(route, actionLabel),
      durationMs: 5200,
    });
  }, [activeChatConversationId, isMobileChatRoute, location.pathname]);

  useEffect(() => {
    const handleForegroundPushNotification = (event) => {
      showForegroundPushToast(event?.detail || {});
    };

    window.addEventListener(PUSH_FOREGROUND_NOTIFICATION_EVENT, handleForegroundPushNotification);
    return () => {
      window.removeEventListener(PUSH_FOREGROUND_NOTIFICATION_EVENT, handleForegroundPushNotification);
    };
  }, [showForegroundPushToast]);

  const showMailArrivalNotifications = useCallback(async ({ previousUnread = 0, nextUnread = 0 } = {}) => {
    const unreadGrowth = Math.max(0, Number(nextUnread || 0) - Number(previousUnread || 0));
    if (!hasMailPermission || unreadGrowth <= 0) return;
    let feed = null;
    try {
      feed = await mailAPI.getNotificationFeed({ limit: Math.min(5, unreadGrowth) });
    } catch {
      return;
    }
    const items = Array.isArray(feed?.items) ? feed.items.slice(0, Math.min(5, unreadGrowth)) : [];
    if (items.length === 0) return;
    const currentWindowsNotificationState = windowsNotificationStateRef.current || getWindowsNotificationState();
    const isVisible = document.visibilityState === 'visible';
    const currentPushNotificationState = getChatNotificationState();
    const suppressHiddenLocalSystemNotification = Boolean(
      !isVisible
      && currentPushNotificationState.pushSubscribed
      && currentPushNotificationState.backgroundCapable,
    );
    if (!mailChannelEnabledRef.current) return;
    items.slice().reverse().forEach((item) => {
      const messageId = String(item?.id || '').trim();
      const notificationId = getMailSystemNotificationId(item);
      if (!messageId || !notificationId) return;
      if (hasShownMailSystemNotification(notificationId)) return;
      if (!rememberRecentMailNotification(notificationId)) return;
      const { title, body } = getMailNotificationDisplay(item);
      const routeParts = [
        `folder=${encodeURIComponent(String(item?.folder || 'inbox'))}`,
        `message=${encodeURIComponent(messageId)}`,
      ];
      const mailboxId = String(item?.mailbox_id || '').trim();
      if (mailboxId) routeParts.push(`mailbox_id=${encodeURIComponent(mailboxId)}`);
      const route = `/mail?${routeParts.join('&')}`;
      if (isVisible) {
        markMailSystemNotificationShown(notificationId);
        notifyInfoRef.current?.(body, {
          title,
          source: 'mail',
          channel: 'mail',
          action: createNavigateToastAction(route, 'Открыть письмо'),
          dedupeMode: 'recent',
          dedupeKey: `mail:${notificationId}`,
          durationMs: 5200,
        });
        return;
      }
      if (suppressHiddenLocalSystemNotification) return;
      if (currentWindowsNotificationState.enabled && currentWindowsNotificationState.permission === 'granted') {
        createMailSystemNotification(
          { ...item, folder: String(item?.folder || 'inbox') },
          { onNavigate: (target) => navigate(target) },
        );
      }
    });
  }, [hasMailPermission, navigate, rememberRecentMailNotification]);

  const handleApplyPwaUpdate = useCallback(async () => {
    const applied = await applyPwaUpdate();
    if (!applied) {
      notifyWarning('Не удалось обновить HUB-IT автоматически. Обновите страницу вручную.', {
        source: 'pwa',
        dedupeMode: 'recent',
        dedupeKey: 'pwa:update-apply-failed',
      });
      return;
    }
    notifyInfo('HUB-IT обновляется. После активации новой версии страница перезагрузится автоматически.', {
      source: 'pwa',
      dedupeMode: 'recent',
      dedupeKey: 'pwa:update-apply-started',
    });
  }, [notifyInfo, notifyWarning]);

  useEffect(() => {
    chatUnreadSummaryRef.current = {
      messages_unread_total: Number(unreadCounts?.chat_messages_unread_total || 0),
      conversations_unread: Number(unreadCounts?.chat_conversations_unread || 0),
    };
  }, [unreadCounts?.chat_conversations_unread, unreadCounts?.chat_messages_unread_total]);

  useEffect(() => {
    const syncWindowsNotificationState = () => {
      setWindowsNotificationState(getWindowsNotificationState());
    };

    syncWindowsNotificationState();
    window.addEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, syncWindowsNotificationState);
    window.addEventListener('focus', syncWindowsNotificationState);
    document.addEventListener('visibilitychange', syncWindowsNotificationState);
    return () => {
      window.removeEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, syncWindowsNotificationState);
      window.removeEventListener('focus', syncWindowsNotificationState);
      document.removeEventListener('visibilitychange', syncWindowsNotificationState);
    };
  }, []);

  useEffect(() => {
    if (!windowsNotificationState?.supported) return;
    if (windowsNotificationState?.permission !== 'granted') return;
    if (windowsNotificationState?.explicitlySet) return;
    autoEnableWindowsNotificationsIfGranted();
  }, [
    windowsNotificationState?.explicitlySet,
    windowsNotificationState?.permission,
    windowsNotificationState?.supported,
  ]);

  useEffect(() => {
    if (!hasChatPermission || !CHAT_WS_ENABLED) return undefined;
    const handleUnreadSummary = (event) => {
      const detail = event?.detail || {};
      const messagesUnreadTotal = Math.max(0, Number(detail?.messages_unread_total || 0));
      const conversationsUnread = Math.max(0, Number(detail?.conversations_unread || 0));
      chatUnreadSummaryRef.current = {
        messages_unread_total: messagesUnreadTotal,
        conversations_unread: conversationsUnread,
      };
      setUnreadCounts((prev) => ({
        ...prev,
        chat_messages_unread_total: messagesUnreadTotal,
        chat_conversations_unread: conversationsUnread,
      }));
    };

    window.addEventListener(CHAT_SOCKET_UNREAD_SUMMARY_EVENT, handleUnreadSummary);
    return () => {
      window.removeEventListener(CHAT_SOCKET_UNREAD_SUMMARY_EVENT, handleUnreadSummary);
    };
  }, [hasChatPermission]);

  useEffect(() => {
    if (!hasChatPermission || !CHAT_WS_ENABLED) {
      setChatSocketStatus('disabled');
      return undefined;
    }
    setChatSocketStatus(chatSocket.getConnectionState());
    const handleChatSocketStatus = (event) => {
      const status = String(event?.detail?.status || '').trim() || 'disconnected';
      setChatSocketStatus(status);
    };
    window.addEventListener(CHAT_SOCKET_STATUS_EVENT, handleChatSocketStatus);
    return () => {
      window.removeEventListener(CHAT_SOCKET_STATUS_EVENT, handleChatSocketStatus);
    };
  }, [hasChatPermission]);

  useEffect(() => {
    if (!hasChatPermission || !CHAT_WS_ENABLED) return undefined;
    const handleChatMessageCreated = (event) => {
      const envelope = event?.detail || {};
      const message = envelope?.payload || {};
      const conversationId = String(envelope?.conversation_id || message?.conversation_id || '').trim();
      const messageId = String(message?.id || '').trim();
      if (!messageId || !conversationId || Boolean(message?.is_own)) return;
      if (!claimChatMessageNotification(messageId)) return;

      const isActiveVisibleConversation = (
        location.pathname.startsWith('/chat')
        && activeChatConversationId === conversationId
        && document.visibilityState === 'visible'
      );
      const isVisible = document.visibilityState === 'visible';
      if (isActiveVisibleConversation) {
        setChatForegroundDiagnostic('active_visible_conversation');
        return;
      }
      if (isMobileChatRoute && isVisible) {
        setChatForegroundDiagnostic('mobile_chat_route_visible');
        return;
      }

      const previewText = getMessagePreview(message);
      const senderName = String(message?.sender?.full_name || message?.sender?.username || '').trim() || 'Собеседник';
      const navigateTo = buildChatNotificationRoute({ conversationId, messageId });
      if (isVisible) {
        notifyInfoRef.current?.(previewText, {
          title: senderName,
          source: 'chat',
          channel: 'system',
          dedupeMode: 'recent',
          dedupeKey: `chat:${messageId}`,
          action: createNavigateToastAction(navigateTo, 'Открыть чат'),
          durationMs: 5200,
        });
      }

      const currentChatNotificationState = getChatNotificationState();
      if (!currentChatNotificationState.enabled) {
        setChatForegroundDiagnostic('notifications_disabled');
        return;
      }
      if (currentChatNotificationState.permission !== 'granted') {
        setChatForegroundDiagnostic('permission_not_granted');
        return;
      }
      const shouldShowLocalSystemNotification = (
        !isVisible
        && !shouldDeliverExternalChatViaPushOnly(currentChatNotificationState)
      );
      // #region agent log
      emitAgentDebugLog({
        location: 'MainLayout.jsx:handleChatMessageCreated',
        message: shouldShowLocalSystemNotification ? 'local system notification requested' : 'local system notification skipped',
        hypothesisId: 'H-EXT-DUP',
        data: {
          messageId,
          conversationId,
          visibility: document.visibilityState,
          pushSubscribed: currentChatNotificationState.pushSubscribed,
          backgroundCapable: currentChatNotificationState.backgroundCapable,
          shouldShowLocalSystemNotification,
        },
      });
      // #endregion
      if (shouldShowLocalSystemNotification) {
        setChatForegroundDiagnostic('');
        createChatSystemNotification({
          messageId,
          title: senderName,
          body: previewText,
          conversationId,
          onNavigate: (target) => navigate(target || navigateTo),
        });
      } else {
        setChatForegroundDiagnostic('');
      }
    };

    window.addEventListener(CHAT_SOCKET_MESSAGE_CREATED_EVENT, handleChatMessageCreated);
    return () => {
      window.removeEventListener(CHAT_SOCKET_MESSAGE_CREATED_EVENT, handleChatMessageCreated);
    };
  }, [activeChatConversationId, hasChatPermission, location.pathname, navigate]);
useEffect(() => {
  const handleToastActionExecute = (event) => {
    const action = normalizeToastAction(event?.detail);
    if (!action || action.kind !== 'navigate') return;
    navigate(action.to);
  };

  window.addEventListener(TOAST_ACTION_EXECUTE_EVENT, handleToastActionExecute);
  return () => {
    window.removeEventListener(TOAST_ACTION_EXECUTE_EVENT, handleToastActionExecute);
  };
}, [navigate]);

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newState));
  };

  // Fetch available databases
  useEffect(() => {
    const handleOpenSidebar = () => setDrawerOpen(true);
    window.addEventListener('open-sidebar', handleOpenSidebar);
    return () => window.removeEventListener('open-sidebar', handleOpenSidebar);
  }, []);

  useEffect(() => {
    const fetchDatabases = async () => {
      try {
        const data = await databaseAPI.getAvailableDatabases();
        setDatabases(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error fetching databases:', error);
        setDbLoading(false);
      }
    };

    const fetchCurrentDb = async () => {
      try {
        const data = await databaseAPI.getCurrentDatabase();
        setCurrentDb({
          id: normalizeDbId(data?.id || data?.database_id || ''),
          name: data?.name || data?.database || data?.database_name || '',
        });
        setDbLocked(String(data?.locked || '') === 'true');
      } catch (error) {
        console.error('Error fetching current database:', error);
      } finally {
        setDbLoading(false);
      }
    };

    const run = () => {
      if (databaseMetaLoadedRef.current) {
        setDbLoading(false);
        return;
      }
      databaseMetaLoadedRef.current = true;
      fetchDatabases();
      fetchCurrentDb();
    };

    if (!isChatRoute) {
      run();
      return undefined;
    }

    if (!drawerOpen) {
      setDbLoading(false);
      return undefined;
    }

    run();
    return undefined;
  }, [drawerOpen, isChatRoute]);

  useEffect(() => {
    if (databases.length === 0) return;

    const currentId = normalizeDbId(currentDb?.id);
    const storedId = normalizeDbId(localStorage.getItem('selected_database'));
    const preferredId = currentId || storedId;

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

  const fetchUnreadCounts = useCallback(async (
    hubCountsOverride = null,
    {
      reason = 'auto',
      forceMailUnread = false,
    } = {},
  ) => {
    if (!hasDashboardPermission && !hasTasksPermission && !hasMailPermission && !hasChatPermission) return;
    if (fetchUnreadCountsInFlightRef.current) return fetchUnreadCountsInFlightRef.current;

    const run = (async () => {
      try {
        const previousCounts = unreadCountsRef.current || {};
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
        let chatMessagesUnreadTotal = Number(chatUnreadSummaryRef.current?.messages_unread_total || 0);
        let chatConversationsUnread = Number(chatUnreadSummaryRef.current?.conversations_unread || 0);
        let mailUnread = 0;
        let mailUnreadResolved = !hasMailPermission;

        const applyHubCounts = (data) => {
          const counts = data || {};
          notifTotal = Number(counts.notifications_unread_total || 0);
          annUnread = Number(counts.announcements_unread || 0);
          annAckPending = Number(counts.announcements_ack_pending || 0);
          tasksOpenTotal = Number(counts.tasks_open_total || counts.tasks_open || 0);
          tasksOpen = Number(counts.tasks_open || counts.tasks_open_total || 0);
          tasksNew = Number(counts.tasks_new || 0);
          tasksAssigneeOpen = Number(counts.tasks_assignee_open || 0);
          tasksCreatedOpen = Number(counts.tasks_created_open || 0);
          tasksControllerOpen = Number(counts.tasks_controller_open || 0);
          tasksReviewRequired = Number(counts.tasks_review_required || 0);
          tasksOverdue = Number(counts.tasks_overdue || 0);
          tasksWithUnreadComments = Number(counts.tasks_with_unread_comments || 0);
        };

        const promises = [];
        if (hasHubNotificationPermission) {
          if (hubCountsOverride && typeof hubCountsOverride === 'object') {
            applyHubCounts(hubCountsOverride);
          } else {
            promises.push(apiClient.get('/hub/notifications/unread-counts').then((res) => {
              applyHubCounts(res?.data || {});
            }));
          }
        }

        if (hasMailPermission) {
          const now = Date.now();
          const shouldReuseMailUnread = Boolean(
            isMailRoute
            && document.visibilityState === 'visible'
            && !forceMailUnread
            && mailUnreadFetchedAtRef.current > 0
            && ['auto', 'hub-poll', 'timer', 'visibility'].includes(String(reason || ''))
            && (now - Number(mailUnreadFetchedAtRef.current || 0)) < MAIL_ROUTE_UNREAD_REFRESH_TTL_MS
          );

          if (shouldReuseMailUnread) {
            mailUnread = Number(previousCounts.mail_unread || 0);
            mailUnreadResolved = true;
          } else {
            promises.push(mailAPI.getUnreadCount({
              force: forceMailUnread,
            }).then((data) => {
              mailUnread = Number(data?.unread_count || 0);
              mailUnreadResolved = true;
              mailUnreadFetchedAtRef.current = Date.now();
            }));
          }
        }

        if (hasChatPermission && !CHAT_WS_ENABLED) {
          promises.push(chatAPI.getUnreadSummary().then((data) => {
            chatMessagesUnreadTotal = Number(data?.messages_unread_total || 0);
            chatConversationsUnread = Number(data?.conversations_unread || 0);
          }));
        }

        await Promise.allSettled(promises);

        const nextCounts = {
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
          chat_messages_unread_total: CHAT_WS_ENABLED ? Number(previousCounts.chat_messages_unread_total || 0) : chatMessagesUnreadTotal,
          chat_conversations_unread: CHAT_WS_ENABLED ? Number(previousCounts.chat_conversations_unread || 0) : chatConversationsUnread,
          mail_unread: mailUnread,
        };
        unreadCountsRef.current = nextCounts;
        const previousMailUnread = Number(previousCounts.mail_unread || 0);
        const hadMailUnreadBaseline = mailUnreadBaselineReadyRef.current;
        if (hasMailPermission && mailUnreadResolved && !hadMailUnreadBaseline) {
          mailUnreadBaselineReadyRef.current = true;
        }
        if (mailUnreadResolved && hadMailUnreadBaseline && mailUnread > previousMailUnread) {
          window.dispatchEvent(new CustomEvent('mail-needs-refresh'));
          await showMailArrivalNotifications({
            previousUnread: previousMailUnread,
            nextUnread: mailUnread,
          });
        }
        setUnreadCounts(nextCounts);
      } catch (error) {
        console.error('Hub unread counts error:', error);
      }
    })();

    fetchUnreadCountsInFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (fetchUnreadCountsInFlightRef.current === run) {
        fetchUnreadCountsInFlightRef.current = null;
      }
    }
  }, [
    hasDashboardPermission,
    hasTasksPermission,
    hasChatPermission,
    hasHubNotificationPermission,
    hasMailPermission,
    isMailRoute,
    showMailArrivalNotifications,
  ]);

  const refreshBellInbox = useCallback(async () => {
    if (!hasHubNotificationPermission && !hasMailPermission) {
      setNotifications([]);
      setMailNotifications([]);
      return;
    }
    try {
      let nextHubItems = [];
      let nextMailItems = [];
      const requests = [];
      if (hasHubNotificationPermission) {
        requests.push(
          apiClient.get('/hub/notifications/poll', {
            params: {
              limit: 60,
              unread_only: true,
            },
          }).then((response) => {
            nextHubItems = (Array.isArray(response?.data?.items) ? response.data.items : [])
              .filter((item) => Number(item?.unread || 0) === 1)
              .sort((left, right) => String(right?.created_at || '').localeCompare(String(left?.created_at || '')));
          }),
        );
      }
      if (hasMailPermission) {
        requests.push(
          mailAPI.getNotificationFeed({
            limit: 20,
          }).then((data) => {
            nextMailItems = (Array.isArray(data?.items) ? data.items : [])
              .filter((item) => !Boolean(item?.is_read))
              .sort((left, right) => String(right?.received_at || '').localeCompare(String(left?.received_at || '')));
          }),
        );
      }
      await Promise.allSettled(requests);
      setNotifications(nextHubItems);
      setMailNotifications(nextMailItems);
    } catch (error) {
      console.error('Bell inbox refresh failed:', error);
    }
  }, [hasHubNotificationPermission, hasMailPermission]);

  useEffect(() => {
    if (!hasMailPermission) return undefined;
    let cancelled = false;
    const loadMailChannelPreference = async () => {
      try {
        const data = await settingsAPI.getNotificationPreferences();
        if (!cancelled) {
          mailChannelEnabledRef.current = Boolean(data?.channels?.mail ?? true);
        }
      } catch {
        if (!cancelled) {
          mailChannelEnabledRef.current = true;
        }
      }
    };
    loadMailChannelPreference();
    return () => {
      cancelled = true;
    };
  }, [hasMailPermission]);

  useEffect(() => {
    if (!hasMailPermission) return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      fetchUnreadCountsRef.current?.(null, { reason: 'visibility-hidden', forceMailUnread: true });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [hasMailPermission]);

  useEffect(() => {
    fetchUnreadCountsRef.current = fetchUnreadCounts;
  }, [fetchUnreadCounts]);

  useEffect(() => {
    refreshBellInboxRef.current = refreshBellInbox;
  }, [refreshBellInbox]);

  useEffect(() => {
    if (!hasDashboardPermission && !hasTasksPermission && !hasMailPermission && !hasChatPermission) return undefined;

    const pollNotifications = async ({ forceFull = false, enableToasts = true, ignoreBackoff = false } = {}) => {
      const currentWindowsNotificationState = windowsNotificationStateRef.current || getWindowsNotificationState();
      const allowBackgroundPolling = Boolean(
        currentWindowsNotificationState.enabled
        && currentWindowsNotificationState.permission === 'granted',
      );
      if (document.visibilityState !== 'visible' && !allowBackgroundPolling) {
        if (hasMailPermission) {
          await fetchUnreadCounts(null, { reason: 'hub-poll-mail-only', forceMailUnread: true });
        }
        return;
      }
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

          const isVisible = document.visibilityState === 'visible';
          const shouldShowToasts = enableToasts && !forceFull && !hubPollSuppressToastsRef.current && isVisible;
          const shouldShowSystemNotifications = Boolean(
            enableToasts
            && !forceFull
            && !hubPollSuppressToastsRef.current
            && currentWindowsNotificationState.enabled
            && currentWindowsNotificationState.permission === 'granted'
            && !isVisible
          );
          if (shouldShowToasts || shouldShowSystemNotifications) {
            items
              .slice()
              .reverse()
              .forEach((item) => {
                const id = String(item?.id || '').trim();
                if (!id || hasSeenHubNotificationRef.current?.(id)) return;
                const entityType = String(item?.entity_type || '').trim().toLowerCase();
                if (entityType === 'chat' && hasChatPermission && CHAT_WS_ENABLED) {
                  return;
                }
                const rawTitle = String(item?.title || '').trim();
                const rawBody = String(item?.body || '').trim();
                const toastMessage = rawBody || rawTitle || 'Новое уведомление';
                const toastTitle = rawBody ? (rawTitle || 'Новое уведомление') : 'Уведомление';
                const navigateTo = getHubNotificationNavigateTo(item);
                const actionLabel = getHubNotificationActionLabel(item);
                if (shouldShowToasts) {
                  notifyInfoRef.current?.(toastMessage, {
                    title: toastTitle,
                    source: 'hub',
                    channel: 'system',
                    action: createNavigateToastAction(navigateTo, actionLabel),
                    dedupeMode: 'recent',
                    dedupeKey: `hub:${id}`,
                    durationMs: 5200,
                  });
                }
                if (shouldShowSystemNotifications) {
                  createHubSystemNotification(item, {
                    onNavigate: (target) => navigate(target),
                  });
                  try {
                    const audio = new window.Audio('/sounds/notification.mp3');
                    audio.play().catch(() => { /* ignore autoplay blocks */ });
                  } catch (e) {
                    // Ignore audio creation errors
                  }
                }
              });
          }

          markHubNotificationsSeenRef.current?.(itemIds);
        }

        if (hubPollSuppressToastsRef.current) {
          hubPollSuppressToastsRef.current = false;
        }

        await fetchUnreadCounts(payload?.unread_counts || null, { reason: 'hub-poll' });
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

    let timer = null;
    let onVisible = null;
    let onHubRefresh = null;

    if (hasHubNotificationPermission) {
      pollNotificationsRef.current = pollNotifications;
      lastPollRef.current = '';
      hubPollBackoffUntilRef.current = 0;
      hubPollFailureCountRef.current = 0;
      hubPollLastWarnAtRef.current = 0;
      hubPollSuppressToastsRef.current = false;

      pollNotifications({ forceFull: true, enableToasts: false });
      timer = setInterval(() => {
        pollNotifications({ forceFull: false, enableToasts: true });
      }, HUB_POLL_INTERVAL_MS);
      onVisible = () => {
        if (document.visibilityState === 'visible') {
          pollNotifications({ forceFull: false, enableToasts: false });
        }
      };
      onHubRefresh = () => {
        pollNotifications({ forceFull: true, enableToasts: false, ignoreBackoff: true });
        if (notificationsOpenRef.current) {
          refreshBellInboxRef.current?.();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('hub-refresh-notifications', onHubRefresh);
    } else if (hasMailPermission || (hasChatPermission && !CHAT_WS_ENABLED)) {
      pollNotificationsRef.current = null;
      fetchUnreadCounts(null, { reason: 'timer' });
      timer = setInterval(() => {
        fetchUnreadCounts(null, { reason: 'timer' });
        if (notificationsOpenRef.current) {
          refreshBellInboxRef.current?.();
        }
      }, HUB_POLL_INTERVAL_MS);
    }

    const onMailChange = () => {
      fetchUnreadCounts(null, { reason: 'mail-change', forceMailUnread: true });
      if (notificationsOpenRef.current) {
        refreshBellInboxRef.current?.();
      }
    };
    const onChatUnreadRefresh = () => {
      fetchUnreadCounts(null, { reason: 'chat-unread' });
      if (notificationsOpenRef.current) {
        refreshBellInboxRef.current?.();
      }
    };
    window.addEventListener('mail-read', onMailChange);
    window.addEventListener('mail-list-refreshed', onMailChange);
    window.addEventListener('chat-unread-needs-refresh', onChatUnreadRefresh);

    return () => {
      pollNotificationsRef.current = null;
      if (timer) clearInterval(timer);
      if (onVisible) document.removeEventListener('visibilitychange', onVisible);
      if (onHubRefresh) window.removeEventListener('hub-refresh-notifications', onHubRefresh);
      window.removeEventListener('mail-read', onMailChange);
      window.removeEventListener('mail-list-refreshed', onMailChange);
      window.removeEventListener('chat-unread-needs-refresh', onChatUnreadRefresh);
    };
  }, [
    fetchUnreadCounts,
    hasDashboardPermission,
    hasTasksPermission,
    hasChatPermission,
    hasHubNotificationPermission,
    hasMailPermission,
    refreshBellInbox,
    navigate,
  ]);

  const handleLogout = () => {
    setAccountMenuAnchorEl(null);
    logout();
    navigate('/login');
  };

  const toggleToolsGroup = () => {
    setSidebarToolsExpanded((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_TOOLS_EXPANDED_KEY, String(next));
      return next;
    });
  };

  const openAccountRoute = (path) => {
    setAccountMenuAnchorEl(null);
    setDrawerOpen(false);
    navigate(path);
  };

  const handleMarkNotificationRead = async (notificationId) => {
    const id = String(notificationId || '').trim();
    if (!id) return;
    try {
      await apiClient.post(`/hub/notifications/${encodeURIComponent(id)}/read`);
      await Promise.all([
        refreshBellInboxRef.current?.(),
        fetchUnreadCountsRef.current?.(),
      ]);
    } catch (error) {
      console.error('Mark notification read failed:', error);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    if (unreadBellInboxCount <= 0) return;
    try {
      const requests = [];
      if (unreadHubNotificationCount > 0 && (hasDashboardPermission || hasTasksPermission || hasChatPermission)) {
        requests.push(apiClient.post('/hub/notifications/read-all'));
      }
      if (unreadMailNotificationCount > 0 && hasMailPermission) {
        requests.push(mailAPI.markAllRead({ folder: 'inbox', folder_scope: 'current' }));
      }
      await Promise.all(requests);
      if (unreadMailNotificationCount > 0) {
        window.dispatchEvent(new CustomEvent('mail-needs-refresh'));
      }
      await Promise.all([
        refreshBellInboxRef.current?.(),
        fetchUnreadCountsRef.current?.(),
      ]);
    } catch (error) {
      console.error('Mark all notifications read failed:', error);
    }
  };

  const handleOpenNotification = async (item) => {
    if (!item) return;
    if (Number(item?.unread || 0) === 1) {
      await handleMarkNotificationRead(item?.id);
    }
    setNotificationsOpen(false);
    navigate(getHubNotificationNavigateTo(item));
  };

  const handleOpenMailNotification = async (item) => {
    const messageId = String(item?.id || '').trim();
    const mailboxId = String(item?.mailbox_id || '').trim();
    if (!messageId) return;
    try {
      if (!Boolean(item?.is_read)) {
        await mailAPI.markAsRead(messageId, mailboxId);
        window.dispatchEvent(new CustomEvent('mail-needs-refresh'));
        await Promise.all([
          refreshBellInboxRef.current?.(),
          fetchUnreadCountsRef.current?.(),
        ]);
      }
    } catch (error) {
      console.error('Mark mail notification read failed:', error);
    }
    setNotificationsOpen(false);
    const routeParts = [
      `folder=${encodeURIComponent(String(item?.folder || 'inbox'))}`,
      `message=${encodeURIComponent(messageId)}`,
    ];
    if (mailboxId) routeParts.push(`mailbox_id=${encodeURIComponent(mailboxId)}`);
    navigate(`/mail?${routeParts.join('&')}`);
  };

  const handleNavigation = (item) => {
    const externalUrl = String(item?.externalUrl || '').trim();
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
      setDrawerOpen(false);
      return;
    }
    const targetPath = String(item?.path || '').trim();
    if (!targetPath) {
      setDrawerOpen(false);
      return;
    }

    const alreadyActive = targetPath === '/networks'
      ? (location.pathname === '/networks' || location.pathname.startsWith('/networks/'))
      : location.pathname === targetPath;
    if (alreadyActive) {
      setPendingNavigation(null);
      setDrawerOpen(false);
      return;
    }

    if (pendingNavigationTimerRef.current) {
      window.clearTimeout(pendingNavigationTimerRef.current);
      pendingNavigationTimerRef.current = null;
    }
    if (pendingNavigationTimeoutRef.current) {
      window.clearTimeout(pendingNavigationTimeoutRef.current);
      pendingNavigationTimeoutRef.current = null;
    }

    void prefetchRouteByPath(targetPath).catch(() => {});
    setPendingNavigation({
      path: targetPath,
      label: String(item?.label || '').trim(),
    });
    setDrawerOpen(false);

    pendingNavigationTimerRef.current = window.setTimeout(() => {
      navigate(targetPath);
      pendingNavigationTimerRef.current = null;
    }, 56);
    pendingNavigationTimeoutRef.current = window.setTimeout(() => {
      setPendingNavigation(null);
      pendingNavigationTimeoutRef.current = null;
    }, 10_000);
  };

  const handleOpenNotifications = () => {
    setNotificationsOpen(true);
    refreshBellInboxRef.current?.();
    fetchUnreadCountsRef.current?.();
  };

  const handleDatabaseChange = async (event) => {
    if (dbLocked) return;
    const newDbId = normalizeDbId(event.target.value);
    const selectedDb = databases.find((db) => normalizeDbId(db.id) === newDbId);

    if (selectedDb && newDbId !== normalizeDbId(currentDb?.id)) {
      try {
        await databaseAPI.switchDatabase(newDbId);
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

  const isItemActive = (path, candidatePath = location.pathname) => {
    return isNavigationItemActive(path, candidatePath);
  };

  const activeNavigationPath = String(pendingNavigation?.path || '').trim() || location.pathname;
  const shouldHideHeaderContext = false;
  const getCurrentTitle = () => {
    const item = visibleNavigationItems.find((item) => isItemActive(item.path, activeNavigationPath));
    if (item) return item.label;
    if (activeNavigationPath.startsWith('/profile')) return 'Профиль';
    if (activeNavigationPath.startsWith('/settings')) return 'Настройки';
    if (activeNavigationPath.startsWith('/admin')) return 'Администрирование';
    if (activeNavigationPath.startsWith('/menu')) return 'Меню';
    return APP_BRAND_NAME;
  };
  const currentTitle = getCurrentTitle();
  const activeMobileNavigationPath = useMemo(() => {
    const item = visibleMobileNavigationItems.find((item) => isNavigationItemActive(item.path, activeNavigationPath));
    if (item?.path) return item.path;
    const isVisibleOverflowRoute = visibleNavigationItems.some((navigationItem) => (
      isNavigationItemActive(navigationItem.path, activeNavigationPath)
    ));
    const isAccountRoute = ['/profile', '/settings', '/admin', '/menu'].some((path) => (
      activeNavigationPath === path || activeNavigationPath.startsWith(`${path}/`)
    ));
    return (isVisibleOverflowRoute || isAccountRoute) ? '/menu' : false;
  }, [activeNavigationPath, visibleMobileNavigationItems, visibleNavigationItems]);
  const documentTitle = useMemo(() => buildDocumentTitle(currentTitle), [currentTitle]);

  useEffect(() => {
    const updateTitle = () => {
      if (document.visibilityState === 'visible') {
        document.title = documentTitle;
        return;
      }
      if (notificationsBadgeValue > 0) {
        document.title = `(${notificationsBadgeValue}) Новое уведомление - ${documentTitle}`;
        return;
      }
      document.title = documentTitle;
    };

    updateTitle();
    document.addEventListener('visibilitychange', updateTitle);
    return () => {
      document.removeEventListener('visibilitychange', updateTitle);
      document.title = APP_BRAND_NAME;
    };
  }, [documentTitle, notificationsBadgeValue]);

  const currentDbName = useMemo(() => {
    const name = String(currentDb?.name || '').trim();
    return name || 'База данных';
  }, [currentDb?.name]);

  const notificationSections = useMemo(
    () => groupItemsByRelativeDate(notifications, 'created_at'),
    [notifications],
  );
  const mailNotificationSections = useMemo(
    () => groupItemsByRelativeDate(mailNotifications, 'received_at'),
    [mailNotifications],
  );

  const handleEnableBrowserNotifications = useCallback(async () => {
    try {
      const permission = await requestBrowserNotificationPermission();
      if (permission === 'granted') {
        setWindowsNotificationsEnabled(true);
      } else if (permission === 'denied') {
        setWindowsNotificationsEnabled(false);
      }
      if (permission === 'granted') {
        if (user && hasAnyAppPushPermission(hasPermission)) {
          await syncChatPushSubscription({ user }).catch(() => {
            refreshChatNotificationState();
          });
        }
      }
    } catch {
      // Ignore permission prompt errors.
    }
  }, [hasPermission, user]);

  const renderNavigationItem = (item, compact = false) => {
    const selected = !item.externalUrl && isItemActive(item.path, activeNavigationPath);
    const pending = !item.externalUrl && String(pendingNavigation?.path || '').trim() === String(item.path || '').trim();
    const badgeCount = getNavigationBadgeCount(item.path, unreadCounts);
    const button = (
      <ListItemButton
        data-testid={`main-layout-sidebar-${item.path.replace(/^\//, '')}`}
        selected={selected}
        onClick={() => handleNavigation(item)}
        onPointerEnter={() => {
          if (!item.externalUrl) void prefetchRouteByPath(item.path).catch(() => {});
        }}
        onFocus={() => {
          if (!item.externalUrl) void prefetchRouteByPath(item.path).catch(() => {});
        }}
        sx={{
          minHeight: compact ? 46 : { xs: 44, sm: 'var(--app-density-sidebar-item-min-height)' },
          px: compact ? 0 : { xs: 1.35, sm: 'var(--app-density-sidebar-item-px)' },
          justifyContent: compact ? 'center' : 'flex-start',
          borderRadius: compact ? '15px' : '12px',
          color: selected ? theme.palette.text.primary : ui.iconPrimary,
          border: '1px solid',
          borderColor: selected ? ui.selectedBorder : 'transparent',
          backgroundColor: selected ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.09) : 'transparent',
          opacity: pending ? 0.96 : 1,
          transition: theme.transitions.create(['background-color', 'color', 'border-color'], {
            duration: theme.transitions.duration.shorter,
          }),
          '& .MuiListItemIcon-root': {
            minWidth: compact ? 0 : { xs: 38, sm: 'var(--app-density-sidebar-icon-min-width)' },
            justifyContent: 'center',
            color: selected ? theme.palette.primary.main : ui.iconMuted,
          },
          '& .MuiListItemText-primary': {
            fontWeight: selected ? 750 : 600,
            color: selected ? theme.palette.text.primary : ui.iconPrimary,
          },
          '&:hover': {
            backgroundColor: selected ? ui.selectedBg : ui.actionHover,
            borderColor: selected ? ui.selectedBorder : ui.actionBorder,
          },
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none',
          },
        }}
      >
        <ListItemIcon>
          {badgeCount > 0 ? (
            <Badge color="error" badgeContent={badgeCount}>
              {item.icon}
            </Badge>
          ) : item.icon}
        </ListItemIcon>
        {compact ? null : <ListItemText primary={item.label} />}
      </ListItemButton>
    );
    return (
      <ListItem key={item.path} disablePadding sx={{ py: compact ? 0.25 : 'var(--app-density-sidebar-item-py)' }}>
        {compact ? (
          <Tooltip title={item.label} placement="right">
            {button}
          </Tooltip>
        ) : button}
      </ListItem>
    );
  };

  const renderDrawerContent = ({ compact = false } = {}) => (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: alpha(ui.navBg, theme.palette.mode === 'dark' ? 0.86 : 0.9),
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      }}
    >
      {hiddenHeader ? (
        <Box sx={{ height: 'max(env(safe-area-inset-top), 10px)', flexShrink: 0 }} />
      ) : (
        <Toolbar sx={{ minHeight: 'var(--app-shell-header-offset) !important', flexShrink: 0 }} />
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: compact ? 0.75 : 'var(--app-density-sidebar-list-px)' }}>
        {compact ? null : (
          <Typography variant="caption" sx={{ display: 'block', px: 1, pt: 0.65, pb: 0.3, color: ui.subtleText, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Основное
          </Typography>
        )}
        <List disablePadding>
          {mainNavigationItems.map((item) => renderNavigationItem(item, compact))}
        </List>

        {toolNavigationItems.length > 0 ? (
          <>
            {compact ? <Divider sx={{ my: 0.7, borderColor: ui.borderSoft }} /> : (
              <ListItem disablePadding sx={{ mt: 0.5 }}>
                <ListItemButton
                  data-testid="main-layout-sidebar-tools-toggle"
                  onClick={toggleToolsGroup}
                  sx={{ minHeight: 34, px: 1, borderRadius: '10px', color: ui.mutedText }}
                >
                  <ListItemText primary="Инструменты" primaryTypographyProps={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }} />
                  <ExpandMoreRoundedIcon
                    sx={{
                      fontSize: 19,
                      transform: sidebarToolsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: theme.transitions.create('transform', { duration: theme.transitions.duration.shorter }),
                    }}
                  />
                </ListItemButton>
              </ListItem>
            )}
            <Collapse in={compact || sidebarToolsExpanded} timeout="auto" unmountOnExit={false}>
              <List disablePadding>
                {toolNavigationItems.map((item) => renderNavigationItem(item, compact))}
              </List>
            </Collapse>
          </>
        ) : null}
      </Box>

      <Box sx={{ flexShrink: 0, p: compact ? 0.75 : 1, borderTop: '1px solid', borderColor: ui.borderSoft }}>
        {compact ? (
          <Tooltip title="Профиль и настройки" placement="right">
            <IconButton
              data-testid="main-layout-account-button"
              onClick={(event) => setAccountMenuAnchorEl(event.currentTarget)}
              sx={{ width: 50, height: 50, borderRadius: '16px' }}
            >
              <AccountAvatar user={user} size={38} />
            </IconButton>
          </Tooltip>
        ) : (
          <ListItemButton
            data-testid="main-layout-account-button"
            onClick={(event) => setAccountMenuAnchorEl(event.currentTarget)}
            sx={{
              minHeight: 58,
              px: 1,
              borderRadius: '15px',
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.55),
              bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.42 : 0.55),
            }}
          >
            <AccountIdentity user={user} />
          </ListItemButton>
        )}
      </Box>
    </Box>
  );

  const shellValue = useMemo(() => ({
    headerMode,
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
    toggleDrawer: () => setDrawerOpen((current) => !current),
    openNotifications: handleOpenNotifications,
    notificationsBadgeValue,
    showNotificationsButton,
    showDatabaseSelector,
    databases,
    currentDb,
    currentDbName,
    dbLoading,
    dbLocked,
    onDatabaseChange: handleDatabaseChange,
  }), [
    currentDb,
    currentDbName,
    databases,
    dbLoading,
    dbLocked,
    drawerOpen,
    handleDatabaseChange,
    handleOpenNotifications,
    headerMode,
    notificationsBadgeValue,
    showDatabaseSelector,
    showNotificationsButton,
  ]);
  const shouldRenderTopSpacer = !hiddenHeader || topBannerOffset > 0;

  return (
    <MainLayoutShellContext.Provider value={shellValue}>
      <Box
        data-testid="main-layout-shell"
        data-app-bar-height={appBarHeight}
        data-top-banner-offset={topBannerOffset}
        style={{
          '--app-shell-banner-offset': `${topBannerOffset}px`,
          '--app-shell-safe-top-offset': 'env(safe-area-inset-top, 0px)',
          '--app-shell-measured-header-offset': hiddenHeader
            ? '0px'
            : appBarHeight > 0
              ? `${appBarHeight}px`
              : 'var(--app-shell-header-offset)',
          '--app-shell-top-offset': 'calc(var(--app-shell-safe-top-offset) + var(--app-shell-banner-offset) + var(--app-shell-measured-header-offset))',
          '--app-shell-mobile-bottom-nav-height': hasMobileBottomNavigation && !mobileBottomNavHidden
            ? 'calc(64px + env(safe-area-inset-bottom, 0px))'
            : '0px',
        }}
        sx={{
          display: 'flex',
          minHeight: isFixedHeightRoute ? 0 : '100dvh',
          height: isFixedHeightRoute ? '100dvh' : undefined,
          overflow: isFixedHeightRoute ? 'hidden' : 'visible',
          bgcolor: ui.pageBg,
          '--app-shell-header-offset': {
            xs: isStandaloneShell ? '52px' : '56px',
            sm: isWindowControlsOverlay
              ? 'var(--app-density-header-overlay-height)'
              : isStandaloneShell
                ? 'var(--app-density-header-standalone-height)'
                : 'var(--app-density-header-height)',
          },
        }}
      >
      <Stack
        ref={topBannerRef}
        data-testid="main-layout-top-banner"
        spacing={0}
        sx={{
          position: 'fixed',
          top: 'var(--app-shell-safe-top-offset)',
          left: 0,
          right: 0,
          zIndex: theme.zIndex.appBar + 1,
          pointerEvents: 'none',
          '& > *': {
            pointerEvents: 'auto',
          },
        }}
      >
        {showNotificationPermissionBanner ? (
          <Alert
            severity="info"
            variant="filled"
            onClose={() => setNotificationPermissionBannerDismissed(true)}
            action={
              <Button color="inherit" size="small" onClick={() => { void handleEnableBrowserNotifications(); }}>
                Включить
              </Button>
            }
            sx={{
              borderRadius: 0,
              alignItems: 'center',
            }}
          >
            Разрешите уведомления браузера, чтобы получать новые задачи, сообщения и почту.
          </Alert>
        ) : null}

        {showOfflineBanner ? (
          <Alert
            severity="warning"
            variant="filled"
            sx={{
              borderRadius: 0,
              alignItems: 'center',
            }}
          >
            Нет сети. HUB-IT откроет оболочку приложения, а данные загрузятся после восстановления подключения.
          </Alert>
        ) : null}

        {showPwaUpdateBanner ? (
          <Alert
            severity="info"
            variant="filled"
            action={(
              <Button color="inherit" size="small" onClick={() => { void handleApplyPwaUpdate(); }}>
                Обновить
              </Button>
            )}
            sx={{
              borderRadius: 0,
              alignItems: 'center',
            }}
          >
            Доступна новая версия HUB-IT.
          </Alert>
        ) : null}
      </Stack>

      {/* AppBar */}
        {!hiddenHeader ? (
          <AppBar
            ref={appBarRef}
            data-testid="main-layout-app-bar"
            position="fixed"
            sx={{
              top: `calc(var(--app-shell-safe-top-offset) + ${topBannerOffset}px)`,
              bgcolor: alpha(ui.shellBg, theme.palette.mode === 'dark' ? 0.94 : 0.9),
              color: theme.palette.text.primary,
              boxShadow: 'none',
              borderBottom: '1px solid',
              borderColor: ui.borderSoft,
              backdropFilter: 'blur(18px)',
              pt: isWindowControlsOverlay ? 'env(titlebar-area-height, 0px)' : 0,
              width: { sm: sidebarCollapsed ? `calc(100% - ${DRAWER_RAIL_WIDTH}px)` : `calc(100% - ${DRAWER_WIDTH_CSS_VAR})` },
              ml: { sm: sidebarCollapsed ? `${DRAWER_RAIL_WIDTH}px` : DRAWER_WIDTH_CSS_VAR },
              transition: (theme) => theme.transitions.create(['width', 'margin'], {
                duration: theme.transitions.duration.standard,
              }),
            }}
          >
            <Toolbar
              sx={{
                minHeight: 'var(--app-shell-header-offset) !important',
                px: isMobileChatRoute ? 0.75 : (notificationsOnlyHeader ? 1.25 : undefined),
              }}
            >
              {notificationsOnlyHeader ? (
                <>
                  {!isPhone ? (
                    <IconButton
                      edge="start"
                      aria-label="Открыть главное меню"
                      onClick={() => {
                        toggleSidebar();
                      }}
                      sx={{
                        mr: 1,
                        ...getOfficeQuietActionSx(ui, theme, 'neutral', {
                          borderColor: 'transparent',
                          bgcolor: 'transparent',
                        }),
                      }}
                    >
                      <MenuIcon />
                    </IconButton>
                  ) : null}
                  {headerInlineContent ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, mr: 1 }}>
                      {headerInlineContent}
                    </Box>
                  ) : null}
                  <Box sx={{ flexGrow: 1 }} />
                  {showNotificationsButton ? (
                    <IconButton
                      aria-label="Открыть уведомления"
                      onClick={handleOpenNotifications}
                      sx={{
                        ...getOfficeQuietActionSx(ui, theme, 'neutral', {
                          borderColor: 'transparent',
                          bgcolor: 'transparent',
                        }),
                      }}
                    >
                      <Badge color="error" badgeContent={notificationsBadgeValue}>
                        <NotificationsIcon />
                      </Badge>
                    </IconButton>
                  ) : null}
                </>
              ) : (
                <>
                  {!isPhone ? (
                    <IconButton
                      edge="start"
                      onClick={() => {
                        toggleSidebar();
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
                  ) : null}
                  {isMobileChatRoute ? (
                    <Box sx={{ flexGrow: 1 }} />
                  ) : minimalHeader ? (
                    shouldHideHeaderContext ? (
                      <Box sx={{ flexGrow: 1 }} />
                    ) : (
                      <>
                        <Box sx={{ flexGrow: 1 }} />
                        {!showDatabaseSelector ? null : dbLoading ? (
                          <CircularProgress size={20} sx={{ mr: 1.5 }} />
                        ) : (
                          <FormControl size="small" sx={{ mr: 1.5, minWidth: { xs: 132, sm: 160 } }}>
                            <Select
                              value={normalizeDbId(currentDb?.id)}
                              onChange={handleDatabaseChange}
                              disabled={dbLocked}
                              displayEmpty
                              renderValue={() => (
                                <Chip
                                  label={currentDbName}
                                  size="small"
                                  sx={{
                                    maxWidth: 120,
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
                        )}
                      </>
                    )
                  ) : (
                    <>
                      <Stack direction="row" spacing={1.2} alignItems="center" sx={{ flexGrow: 1, minWidth: 0 }}>
                        {!shouldHideHeaderContext && !isPhone && (
                          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.25 }}>
                            {currentTitle}
                          </Typography>
                        )}
                      </Stack>
                      {showNotificationsButton && !minimalHeader ? (
                        <IconButton
                          aria-label="Открыть уведомления"
                          onClick={handleOpenNotifications}
                          sx={{
                            mr: 1,
                            ...getOfficeQuietActionSx(ui, theme, 'neutral', {
                              borderColor: 'transparent',
                              bgcolor: 'transparent',
                            }),
                          }}
                        >
                          <Badge color="error" badgeContent={notificationsBadgeValue}>
                            <NotificationsIcon />
                          </Badge>
                        </IconButton>
                      ) : null}
                      {!minimalHeader && !shouldHideHeaderContext && showDatabaseSelector && (
                        dbLoading ? (
                          <Box sx={{ mr: 1.5, display: 'flex', alignItems: 'center', minWidth: { xs: 132, sm: 180 }, justifyContent: 'center' }}>
                            <CircularProgress size={20} />
                          </Box>
                        ) : (
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
                        )
                      )}
                      {dbLocked && !minimalHeader && !shouldHideHeaderContext && showDatabaseSelector && (
                        <Chip
                          label="БД закреплена"
                          size="small"
                          color="warning"
                          sx={{ mr: 2, border: 'none' }}
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </Toolbar>
          </AppBar>
        ) : null}

      {/* Sidebar Drawer */}
      <Box
        component="nav"
        sx={{
          width: { sm: sidebarCollapsed ? `${DRAWER_RAIL_WIDTH}px` : DRAWER_WIDTH_CSS_VAR },
          flexShrink: { sm: 0 },
          overflow: 'hidden',
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
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH_CSS_VAR, bgcolor: ui.navBg, borderRightColor: ui.borderSoft },
          }}
        >
          {renderDrawerContent({ compact: false })}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: sidebarCollapsed ? DRAWER_RAIL_WIDTH : DRAWER_WIDTH_CSS_VAR,
              overflowX: 'hidden',
              bgcolor: ui.navBg,
              borderRightColor: ui.borderSoft,
              transition: (theme) => theme.transitions.create('width', {
                duration: theme.transitions.duration.standard,
              }),
            },
          }}
          open
        >
          {renderDrawerContent({ compact: sidebarCollapsed })}
        </Drawer>
      </Box>

      <Menu
        anchorEl={accountMenuAnchorEl}
        open={Boolean(accountMenuAnchorEl)}
        onClose={() => setAccountMenuAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 220,
              mb: 1,
              borderRadius: '16px',
              border: '1px solid',
              borderColor: ui.borderSoft,
              bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.9 : 0.94),
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: ui.dialogShadow,
            },
          },
        }}
      >
        <MenuItem onClick={() => openAccountRoute('/profile')}>
          <PersonOutlineRoundedIcon sx={{ mr: 1.2, color: ui.iconMuted }} />
          Профиль
        </MenuItem>
        <MenuItem onClick={() => openAccountRoute('/settings')}>
          <SettingsIcon sx={{ mr: 1.2, color: ui.iconMuted }} />
          Настройки
        </MenuItem>
        {showAdminArea ? (
          <MenuItem onClick={() => openAccountRoute('/admin')}>
            <AdminPanelSettingsOutlinedIcon sx={{ mr: 1.2, color: ui.iconMuted }} />
            Администрирование
          </MenuItem>
        ) : null}
        <Divider />
        <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
          <LogoutIcon sx={{ mr: 1.2 }} />
          Выход
        </MenuItem>
      </Menu>

      {/* Main Content */}
      <Box
        component="main"
        data-testid="main-layout-content"
        data-content-mode={contentMode}
        data-edge-to-edge-mobile={isEdgeToEdgeMobileContent ? 'true' : 'false'}
        sx={{
          flexGrow: 1,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          display: isFixedHeightRoute ? 'flex' : 'block',
          flexDirection: isFixedHeightRoute ? 'column' : undefined,
          overflow: isFixedHeightRoute ? 'hidden' : 'visible',
          px: {
            xs: (isMobileChatRoute || isEdgeToEdgeMobileContent) ? 0 : 2,
            sm: (isMobileChatRoute || isEdgeToEdgeMobileContent) ? 0 : 'var(--app-density-page-padding)',
          },
          pb: {
            xs: hasMobileBottomNavigation
              ? (mobileBottomNavHidden ? 0 : 'var(--app-shell-mobile-bottom-nav-height)')
              : ((isMobileChatRoute || isEdgeToEdgeMobileContent) ? 0 : 2),
            sm: (isMobileChatRoute || isEdgeToEdgeMobileContent) ? 0 : 'var(--app-density-page-padding)',
          },
          pt: {
            xs: (isMobileChatRoute || isEdgeToEdgeMobileContent) ? 0 : 2,
            sm: (isMobileChatRoute || isEdgeToEdgeMobileContent) ? 0 : 'var(--app-density-page-padding)',
          },
          bgcolor: (isMobileChatRoute || isEdgeToEdgeMobileContent) ? 'transparent' : ui.pageBg,
          width: {
            xs: '100%',
            sm: sidebarCollapsed ? `calc(100% - ${DRAWER_RAIL_WIDTH}px)` : `calc(100% - ${DRAWER_WIDTH_CSS_VAR})`
          },
          transition: (theme) => theme.transitions.create(['width', 'margin', 'padding-bottom'], {
            duration: hasMobileBottomNavigation ? mobileBottomNavTransitionMs : theme.transitions.duration.standard,
            easing: theme.transitions.easing.easeInOut,
          }),
        }}
      >
        {shouldRenderTopSpacer ? (
          <Box
            aria-hidden="true"
            data-testid="main-layout-top-spacer"
            style={{ height: 'var(--app-shell-top-offset)' }}
            sx={{ flexShrink: 0 }}
          />
        ) : null}
        {children}
        {pendingNavigation ? (
          <BrandedRouteLoader
            overlay
            label={`Открываем ${pendingNavigation.label || 'раздел'}...`}
            sublabel="Подготавливаем интерфейс HUB-IT"
          />
        ) : null}
      </Box>

      {hasMobileBottomNavigation ? (
        <Box
          data-testid="main-layout-mobile-bottom-nav"
          data-mobile-bottom-nav-hidden={mobileBottomNavHidden ? 'true' : 'false'}
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: theme.zIndex.appBar + 2,
            bgcolor: alpha(ui.navBg, theme.palette.mode === 'dark' ? 0.82 : 0.86),
            backdropFilter: 'blur(22px) saturate(150%)',
            WebkitBackdropFilter: 'blur(22px) saturate(150%)',
            pb: 'env(safe-area-inset-bottom, 0px)',
            boxShadow: theme.palette.mode === 'dark'
              ? '0 -12px 30px rgba(0,0,0,0.28)'
              : '0 -10px 28px rgba(15,23,42,0.10)',
            transform: mobileBottomNavHidden ? 'translateY(100%)' : 'translateY(0)',
            transition: mobileBottomNavTransition,
            pointerEvents: mobileBottomNavHidden ? 'none' : 'auto',
            visibility: mobileBottomNavHidden ? 'hidden' : 'visible',
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'none',
            },
          }}
        >
          <BottomNavigation
            showLabels
            value={activeMobileNavigationPath}
            onChange={(_, value) => {
              const item = visibleMobileNavigationItems.find((navItem) => navItem.path === value);
              if (item) handleNavigation(item);
            }}
            sx={{
              height: 64,
              bgcolor: 'transparent',
              '& .MuiBottomNavigationAction-root': {
                minWidth: 0,
                minHeight: 56,
                px: 0.2,
                color: ui.iconMuted,
                transition: theme.transitions.create(['color', 'transform'], {
                  duration: theme.transitions.duration.shorter,
                }),
              },
              '& .MuiBottomNavigationAction-root.Mui-selected': {
                color: theme.palette.primary.main,
              },
              '& .mobile-bottom-nav-icon-shell': {
                width: 42,
                height: 30,
                borderRadius: '15px',
                display: 'grid',
                placeItems: 'center',
                transition: theme.transitions.create(['background-color', 'box-shadow', 'transform'], {
                  duration: theme.transitions.duration.shorter,
                }),
              },
              '& .MuiBottomNavigationAction-root.Mui-selected .mobile-bottom-nav-icon-shell': {
                bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.13),
                boxShadow: `0 5px 14px ${alpha(theme.palette.primary.main, 0.16)}`,
                transform: 'translateY(-1px)',
              },
              '& .MuiBottomNavigationAction-label': {
                mt: 0.15,
                maxWidth: '100%',
                fontSize: '0.64rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
              '& .MuiBottomNavigationAction-label.Mui-selected': {
                fontSize: '0.66rem',
                fontWeight: 800,
              },
              '& .MuiSvgIcon-root': {
                fontSize: 24,
              },
              '@media (prefers-reduced-motion: reduce)': {
                '& .MuiBottomNavigationAction-root, & .mobile-bottom-nav-icon-shell': {
                  transition: 'none',
                },
              },
            }}
          >
            {visibleMobileNavigationItems.map((item) => {
              const badgeCount = getNavigationBadgeCount(item.path, unreadCounts);
              const icon = badgeCount > 0 ? (
                <Badge color="error" badgeContent={badgeCount}>
                  {item.icon}
                </Badge>
              ) : item.icon;

              return (
                <BottomNavigationAction
                  key={item.path}
                  value={item.path}
                  label={item.shortLabel || item.label}
                  icon={<Box className="mobile-bottom-nav-icon-shell">{icon}</Box>}
                  data-testid={`main-layout-mobile-bottom-nav-${item.path.replace(/^\//, '')}`}
                  onPointerEnter={() => {
                    if (item.path !== '/menu') void prefetchRouteByPath(item.path).catch(() => {});
                  }}
                  onFocus={() => {
                    if (item.path !== '/menu') void prefetchRouteByPath(item.path).catch(() => {});
                  }}
                  onTouchStart={() => {
                    void prefetchRouteByPath(item.path).catch(() => {});
                  }}
                  sx={{
                    '&.Mui-selected .MuiBottomNavigationAction-label': {
                      color: theme.palette.text.primary,
                    },
                  }}
                />
              );
            })}
          </BottomNavigation>
        </Box>
      ) : null}

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
                <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '1.05rem' }}>Уведомления</Typography>
                {Number(unreadCounts?.notifications_unread_total || 0) > 0 && (
                  <Chip size="small" label={unreadCounts.notifications_unread_total}
                    sx={{ height: 20, fontSize: '0.65rem', fontWeight: 600, bgcolor: ui.selectedBg, color: 'primary.main', border: 'none' }} />
                )}
              </Stack>
              <Stack direction="row" spacing={0.75}>
                {unreadBellInboxCount > 0 && (
                  <Button size="small" onClick={handleMarkAllNotificationsRead}
                    sx={{ textTransform: 'none', fontSize: '0.72rem', fontWeight: 600 }}>
                    Прочитать все
                  </Button>
                )}
              </Stack>
            </Stack>
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
            {notificationSections.length === 0 && mailNotificationSections.length === 0 ? (
              <Box sx={{ ...getOfficeEmptyStateSx(ui, { textAlign: 'center', py: 6 }) }}>
                <NotificationsNoneIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>Нет непрочитанных уведомлений</Typography>
              </Box>
            ) : (
              <>
                {notificationSections.length > 0 ? (
                  <Box sx={{ mb: 2.2 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.4, mb: 1 }}>
                      <NotificationsNoneIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography
                        variant="overline"
                        sx={{ color: 'text.disabled', fontWeight: 600, fontSize: '0.6rem', letterSpacing: '0.1em' }}
                      >
                        Центр управления
                      </Typography>
                    </Stack>
                    {notificationSections.map((section) => (
                      <Box key={section.key} sx={{ mb: 2 }}>
                        <Typography variant="overline" sx={{ color: 'text.disabled', fontWeight: 600, fontSize: '0.6rem', letterSpacing: '0.1em', display: 'block', mb: 0.8, px: 0.5 }}>
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
                    ))}
                  </Box>
                ) : null}

                {mailNotificationSections.length > 0 ? (
                  <Box sx={{ mb: 2.2 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.4, mb: 1 }}>
                      <MailOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography
                        variant="overline"
                        sx={{ color: 'text.disabled', fontWeight: 600, fontSize: '0.6rem', letterSpacing: '0.1em' }}
                      >
                        Почта
                      </Typography>
                    </Stack>
                    {mailNotificationSections.map((section) => (
                      <Box key={`mail-${section.key}`} sx={{ mb: 2 }}>
                        <Typography variant="overline" sx={{ color: 'text.disabled', fontWeight: 600, fontSize: '0.6rem', letterSpacing: '0.1em', display: 'block', mb: 0.8, px: 0.5 }}>
                          {section.label}
                        </Typography>
                        <Stack spacing={0.5}>
                          {section.items.map((item) => {
                            const accentColor = '#2563eb';
                            const senderLine = String(item?.sender || '').trim() || 'Письмо';
                            const previewText = String(item?.body_preview || '').trim();
                            return (
                              <Box key={item.id} sx={{
                                ...getOfficePanelSx(ui, {
                                  p: 1.2,
                                  borderRadius: '12px',
                                  cursor: 'pointer',
                                  bgcolor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.12 : 0.08),
                                  borderColor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.26 : 0.16),
                                  transition: 'all 0.15s ease',
                                  '&:hover': { bgcolor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.16 : 0.10), borderColor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.34 : 0.22) },
                                }),
                              }}
                                onClick={() => handleOpenMailNotification(item)}
                              >
                                <Stack direction="row" spacing={1} alignItems="flex-start">
                                  <Box sx={{
                                    width: 32, height: 32, borderRadius: '10px', flexShrink: 0, mt: 0.2,
                                    bgcolor: alpha(accentColor, theme.palette.mode === 'dark' ? 0.18 : 0.10), display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    <MailOutlineIcon sx={{ fontSize: 16, color: accentColor }} />
                                  </Box>
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                                      <Typography variant="body2" sx={{
                                        fontWeight: 600, fontSize: '0.82rem', lineHeight: 1.3,
                                        color: 'text.primary',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                      }}>
                                        {item?.subject || '(без темы)'}
                                      </Typography>
                                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: accentColor, flexShrink: 0, ml: 1 }} />
                                    </Stack>
                                    <Typography variant="caption" sx={{
                                      color: 'text.secondary', display: 'block', mt: 0.25, fontSize: '0.7rem', lineHeight: 1.3,
                                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                      {senderLine}
                                    </Typography>
                                    {previewText ? (
                                      <Typography variant="caption" sx={{
                                        color: 'text.secondary', display: 'block', mt: 0.2, fontSize: '0.72rem', lineHeight: 1.3,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                      }}>
                                        {previewText}
                                      </Typography>
                                    ) : null}
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
                                      <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
                                        {item?.received_at ? new Date(item.received_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '-'}
                                      </Typography>
                                      <Button size="small" onClick={(e) => { e.stopPropagation(); handleOpenMailNotification(item); }}
                                        sx={{ textTransform: 'none', fontSize: '0.62rem', fontWeight: 600, minWidth: 0, py: 0, px: 0.5 }}>
                                        Открыть
                                      </Button>
                                    </Stack>
                                  </Box>
                                </Stack>
                              </Box>
                            );
                          })}
                        </Stack>
                      </Box>
                    ))}
                  </Box>
                ) : null}
              </>
            )}
          </Box>
        </Box>
      </Drawer>
      </Box>
    </MainLayoutShellContext.Provider>
  );
}

export default MainLayout;
