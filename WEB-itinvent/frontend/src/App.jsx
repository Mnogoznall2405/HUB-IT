/**
 * Main App component with routing and authentication.
 */
import { Component, lazy, Suspense, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CHAT_FEATURE_ENABLED } from './lib/chatFeature';
import BrandedRouteLoader from './components/layout/BrandedRouteLoader';
import ScrollToTop from './components/layout/ScrollToTop';
import { canAccessAdminArea } from './components/account/accountNavigationConfig';
import { forceAppHardReload } from './lib/routeChunkRecovery';
import {
  applyChatPushDiagnostic,
  getChatNotificationState,
  refreshChatNotificationState,
  requestChatPushSyncDrain,
  syncChatPushSubscription,
} from './lib/chatNotifications';
import { emitAgentDebugLog } from './lib/debugClientLog';
import ChatSocketBootstrap from './components/chat/ChatSocketBootstrap';
import DesktopNavigationBootstrap from './components/layout/DesktopNavigationBootstrap';
import DesktopProtocolHandoff from './components/layout/DesktopProtocolHandoff';
import DesktopPresenceBootstrap from './components/layout/DesktopPresenceBootstrap';
import DesktopLifecycleBootstrap from './components/layout/DesktopLifecycleBootstrap';
import DesktopMemoryPressureBootstrap from './components/layout/DesktopMemoryPressureBootstrap';
import { hasAnyAppPushPermission } from './lib/appPushPermissions';
import { syncAppBadge } from './lib/appBadge';
import {
  needsAboutOnboarding,
  rememberPostAuthReturnPath,
  resolvePostAuthenticationPath,
} from './lib/aboutOnboarding';
import { WINDOWS_NOTIFICATIONS_CHANGED_EVENT } from './lib/windowsNotifications';
import {
  loadAboutRoute,
  loadAddressBookRoute,
  loadCompanyStructureRoute,
  loadChatRoute,
  loadComputersRoute,
  loadDashboardRoute,
  loadFeedRoute,
  loadDatabaseRoute,
  loadDocflowRoute,
  loadLoginRoute,
  loadMailRoute,
  loadMobileMenuRoute,
  loadMfuRoute,
  loadMyFilesRoute,
  loadNetworksRoute,
  loadKnowledgeBaseRoute,
  loadProfileRoute,
  loadAdminRoute,
  loadScanCenterRoute,
  loadSettingsRoute,
  loadPasswordsRoute,
  loadGroupsAccessRoute,
  loadSharedFileRoute,
  loadStatisticsRoute,
  loadTasksRoute,
  loadTicketsRoute,
  loadVcsRoute,
  loadWarehouse1CRoute,
  loadFileEgressRoute,
} from './lib/routeLoaders';

// Pages
const Login = lazy(loadLoginRoute);
const About = lazy(loadAboutRoute);
const Dashboard = lazy(loadDashboardRoute);
const Feed = lazy(loadFeedRoute);
const Tasks = lazy(loadTasksRoute);
const Tickets = lazy(loadTicketsRoute);
const Chat = lazy(loadChatRoute);
const Database = lazy(loadDatabaseRoute);
const Networks = lazy(loadNetworksRoute);
const Settings = lazy(loadSettingsRoute);
const Profile = lazy(loadProfileRoute);
const Admin = lazy(loadAdminRoute);
const Statistics = lazy(loadStatisticsRoute);
const Computers = lazy(loadComputersRoute);
const FileEgress = lazy(loadFileEgressRoute);
const ScanCenter = lazy(loadScanCenterRoute);
const Mfu = lazy(loadMfuRoute);
const Mail = lazy(loadMailRoute);
const MobileMenu = lazy(loadMobileMenuRoute);
const Vcs = lazy(loadVcsRoute);
const KnowledgeBase = lazy(loadKnowledgeBaseRoute);
const AddressBook = lazy(loadAddressBookRoute);
const CompanyStructure = lazy(loadCompanyStructureRoute);
const Warehouse1C = lazy(loadWarehouse1CRoute);
const Docflow = lazy(loadDocflowRoute);
const Passwords = lazy(loadPasswordsRoute);
const GroupsAccess = lazy(loadGroupsAccessRoute);
const MyFiles = lazy(loadMyFilesRoute);
const SharedFile = lazy(loadSharedFileRoute);

const routePermissions = [
  { path: '/dashboard', permissions: ['dashboard.read'] },
  { path: '/feed', permissions: ['dashboard.read'] },
  { path: '/tasks', permissions: ['tasks.read'] },
  { path: '/tickets', permissions: ['tickets.read'] },
  ...(CHAT_FEATURE_ENABLED ? [{ path: '/chat', permissions: ['chat.read'] }] : []),
  { path: '/database', permissions: ['database.read'] },
  { path: '/networks', permissions: ['networks.read'] },
  { path: '/mfu', permissions: ['mfu.read'] },
  { path: '/computers', permissions: ['computers.read'] },
  { path: '/scan-center', permissions: ['scan.read'] },
  { path: '/dlp', adminOnly: true },
  { path: '/file-egress', adminOnly: true },
  { path: '/statistics', permissions: ['statistics.read'] },
  { path: '/kb', permissions: ['kb.read'] },
  { path: '/vcs', permissions: ['vcs.read'] },
  { path: '/mail', permissions: ['mail.access'] },
  { path: '/address-book', permissions: ['address_book.read'] },
  { path: '/warehouse-1c', permissions: ['warehouse_1c.read'] },
  { path: '/docflow', permissions: ['docflow.read'] },
  { path: '/passwords', permissions: ['passwords.read'] },
  { path: '/groups-access', permissions: ['groups_access.read'] },
  { path: '/my-files', permissions: ['my_files.read'] },
];

const canAccessAny = (hasPermission, permissions = []) => (
  permissions.some((permission) => hasPermission(permission))
);

const isAdminUser = (user) => String(user?.role || '').trim().toLowerCase() === 'admin';

const canAccessRoute = (hasPermission, user, route) => {
  if (route?.adminOnly) {
    return isAdminUser(user);
  }
  const permissions = route?.permissions || [];
  return permissions.length === 0 || canAccessAny(hasPermission, permissions);
};

const resolveFirstAccessiblePath = (hasPermission, user) => {
  const match = routePermissions.find((item) => canAccessRoute(hasPermission, user, item));
  return match ? match.path : '/login';
};

/**
 * Protected Route component - redirects to login if not authenticated
 */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>Loading...</Box>;
  }

  if (!isAuthenticated()) {
    rememberPostAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to="/login" replace />;
  }

  return children || <Outlet />;
};

const HomeRedirect = () => {
  const { hasPermission, user } = useAuth();
  return <Navigate to={resolveFirstAccessiblePath(hasPermission, user)} replace />;
};

const AboutOnboardingRoute = () => {
  const { user } = useAuth();
  const location = useLocation();

  if (needsAboutOnboarding(user)) {
    rememberPostAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to="/about" replace />;
  }

  return <Outlet />;
};

const RootRoute = () => {
  const { hasPermission, isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return <PageFallback />;
  }

  if (isAuthenticated()) {
    if (needsAboutOnboarding(user)) {
      return <Navigate to="/about" replace />;
    }
    return <Navigate to={resolveFirstAccessiblePath(hasPermission, user)} replace />;
  }

  return <Navigate to="/login" replace />;
};

const LoginRoute = () => {
  const { hasPermission, isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return <PageFallback />;
  }

  if (!isAuthenticated()) {
    return <Login />;
  }

  return (
    <Navigate
      to={needsAboutOnboarding(user)
        ? '/about'
        : resolvePostAuthenticationPath(user, resolveFirstAccessiblePath(hasPermission, user))}
      replace
    />
  );
};

const LegacyNewsRedirect = () => {
  const location = useLocation();
  return <Navigate to={{ pathname: '/feed', search: location.search }} replace />;
};

const PermissionRoute = ({ permission, permissions, adminOnly = false, children }) => {
  const { hasPermission, user } = useAuth();
  const requiredPermissions = Array.isArray(permissions) ? permissions : (permission ? [permission] : []);

  if (adminOnly) {
    return isAdminUser(user) ? (children || <Outlet />) : <Navigate to={resolveFirstAccessiblePath(hasPermission, user)} replace />;
  }

  if (requiredPermissions.length === 0 || canAccessAny(hasPermission, requiredPermissions)) {
    return children || <Outlet />;
  }

  return <Navigate to={resolveFirstAccessiblePath(hasPermission, user)} replace />;
};

const AdminAreaRoute = ({ children }) => {
  const { hasPermission, user } = useAuth();
  if (canAccessAdminArea({ user, hasPermission })) {
    return children || <Outlet />;
  }
  return <Navigate to={resolveFirstAccessiblePath(hasPermission, user)} replace />;
};

export const AppPushBootstrap = () => {
  const { user, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const hasAppPushPermission = hasAnyAppPushPermission(hasPermission, {
    chatFeatureEnabled: CHAT_FEATURE_ENABLED,
  });
  const isChatRoute = String(location?.pathname || '').startsWith('/chat');

  const runPushSync = useCallback((force = false) => {
    if (!hasAppPushPermission || !user) {
      // AppPushBootstrap mounts before AuthProvider finishes restoring the
      // cookie session. Unsubscribing here invalidates a healthy browser
      // endpoint on every cold start. Explicit logout/revocation owns cleanup.
      return;
    }
    void syncChatPushSubscription({ user, force }).catch(() => {
      refreshChatNotificationState();
    });
    requestChatPushSyncDrain();
  }, [hasAppPushPermission, user]);

  const schedulePushSync = useCallback(({ force = false } = {}) => {
    const currentState = getChatNotificationState();
    const needsFastBootstrap = Boolean(
      currentState?.permission === 'granted'
      && (!currentState?.pushSubscribed || currentState?.pendingResubscribe)
    );
    if (!isChatRoute) {
      runPushSync(force);
      return () => {};
    }

    if (needsFastBootstrap && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      let cancelled = false;
      navigator.serviceWorker.ready
        .then(() => {
          if (!cancelled) {
            runPushSync(force);
          }
        })
        .catch(() => {
          if (!cancelled) {
            runPushSync(force);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    let timeoutId = null;
    let idleId = null;
    const start = () => {
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        runPushSync(force);
      }, needsFastBootstrap ? 1_500 : 8_000);
    };

    if (!needsFastBootstrap && typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(() => {
        idleId = null;
        start();
      }, { timeout: 12_000 });
    } else {
      start();
    }

    return () => {
      if (idleId != null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isChatRoute, runPushSync]);

  useEffect(() => {
    if (!user) {
      void syncAppBadge(0);
    }
  }, [user]);

  useEffect(() => {
    return schedulePushSync({ force: false });
  }, [schedulePushSync]);

  useEffect(() => {
    if (!user || !hasAppPushPermission) {
      return undefined;
    }

    const retryTimer = window.setInterval(() => {
      const currentState = getChatNotificationState();
      if (currentState?.permission !== 'granted') return;
      if (currentState?.pushSubscribed && !currentState?.pendingResubscribe) return;
      runPushSync(Boolean(currentState?.pendingResubscribe));
    }, 30_000);

    return () => {
      window.clearInterval(retryTimer);
    };
  }, [hasAppPushPermission, runPushSync, user]);

  useEffect(() => {
    const handleNotificationSettingsChange = () => {
      if (document.visibilityState === 'hidden') return;
      const currentState = getChatNotificationState();
      if (currentState?.permission !== 'granted') return;
      runPushSync(false);
    };

    window.addEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, handleNotificationSettingsChange);
    return () => {
      window.removeEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, handleNotificationSettingsChange);
    };
  }, [runPushSync]);

  useEffect(() => {
    const handleSyncRequest = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      schedulePushSync({ force: false });
    };

    window.addEventListener('focus', handleSyncRequest);
    document.addEventListener('visibilitychange', handleSyncRequest);
    return () => {
      window.removeEventListener('focus', handleSyncRequest);
      document.removeEventListener('visibilitychange', handleSyncRequest);
    };
  }, [schedulePushSync]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleWorkerMessage = (event) => {
      const messageType = String(event?.data?.type || '').trim();
      if (!messageType) return;

      if (messageType === 'itinvent:navigate') {
        const rawRoute = String(event?.data?.route || event?.data?.url || '').trim();
        if (!rawRoute) return;
        const source = String(event?.data?.source || '').trim();
        try {
          const target = new URL(rawRoute, window.location.origin);
          if (target.origin !== window.location.origin) return;
          const nextRoute = `${target.pathname}${target.search}${target.hash}` || '/';
          const fromPath = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/';
          // #region agent log
          emitAgentDebugLog({
            location: 'App.jsx:itinvent:navigate',
            message: 'Navigate from notification/service worker',
            hypothesisId: 'H-NAV',
            runId: 'post-fix',
            data: {
              route: nextRoute,
              source,
              fromPath,
            },
          });
          // #endregion
          // Push opens on mobile often resume a long-lived PWA with a stale JS graph.
          // Soft React navigate then fails lazy /chat chunk load and shows "Нужно обновить экран".
          // One hard assign loads a fresh document that matches the active service worker.
          if (source === 'notificationclick') {
            if (fromPath !== nextRoute) {
              window.location.assign(nextRoute);
            }
            return;
          }
          navigate(nextRoute);
        } catch {
          if (rawRoute.startsWith('/')) {
            if (source === 'notificationclick') {
              const fromPath = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/';
              if (fromPath !== rawRoute) {
                window.location.assign(rawRoute);
              }
              return;
            }
            navigate(rawRoute);
          }
        }
        return;
      }

      if (messageType === 'itinvent:push-subscription-updated') {
        refreshChatNotificationState();
        return;
      }

      if (messageType === 'itinvent:push-diagnostic') {
        applyChatPushDiagnostic({
          stage: String(event?.data?.detail?.stage || event?.data?.stage || '').trim(),
          detail: event?.data?.detail?.detail || event?.data?.detail || {},
          sw_version: String(event?.data?.detail?.sw_version || event?.data?.sw_version || '').trim(),
          ts: String(event?.data?.detail?.ts || event?.data?.ts || '').trim(),
        });
        return;
      }

      if (messageType === 'itinvent:push-foreground-notification') {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('itinvent:push-foreground-notification', {
            detail: event?.data?.detail || {},
          }));
        }
        return;
      }

      if (messageType === 'itinvent:push-subscription-refresh-required') {
        schedulePushSync({ force: true });
      }
    };

    navigator.serviceWorker.addEventListener('message', handleWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleWorkerMessage);
    };
  }, [navigate, schedulePushSync]);

  return null;
};

const PageFallback = () => (
  <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
    <BrandedRouteLoader label="Загружаем раздел..." sublabel="Подготавливаем интерфейс HUB-IT" />
  </Box>
);

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, reloading: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Route render failed:', error);
  }

  handleHardReload = async () => {
    this.setState({ reloading: true });
    await forceAppHardReload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            bgcolor: '#07090c',
            color: '#fff',
            px: 2,
          }}
        >
          <Box
            sx={{
              width: 'min(100%, 420px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '24px',
              bgcolor: 'rgba(255,255,255,0.06)',
              p: 3,
              textAlign: 'center',
            }}
          >
            <Box sx={{ fontSize: 22, fontWeight: 700, mb: 1 }}>Нужно обновить экран</Box>
            <Box sx={{ color: 'rgba(255,255,255,0.62)', fontSize: 14, lineHeight: 1.7, mb: 2 }}>
              Страница была открыта долго, и раздел не удалось догрузить. Нажмите «Обновить» — подтянется новая версия интерфейса.
            </Box>
            <button
              type="button"
              onClick={() => { void this.handleHardReload(); }}
              disabled={this.state.reloading}
              className="min-h-12 rounded-[16px] !bg-cyan-200 px-5 text-sm font-semibold !text-zinc-950 disabled:opacity-60"
            >
              {this.state.reloading ? 'Обновляем...' : 'Обновить'}
            </button>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

function AuthenticatedAppShell() {
  return (
    <AuthProvider>
      <ScrollToTop />
      <DesktopProtocolHandoff />
      <DesktopNavigationBootstrap />
      <DesktopPresenceBootstrap />
      <DesktopLifecycleBootstrap />
      <DesktopMemoryPressureBootstrap />
      <AppPushBootstrap />
      <ChatSocketBootstrap />
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        <RouteErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<RootRoute />} />
              <Route path="/login" element={<LoginRoute />} />
              <Route path="/shared-files/:token" element={<SharedFile />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/about" element={<About mode="onboarding" />} />
                <Route element={<AboutOnboardingRoute />}>
                <Route
                  path="/dashboard"
                  element={<PermissionRoute permission="dashboard.read"><Dashboard /></PermissionRoute>}
                />
                <Route
                  path="/feed"
                  element={<PermissionRoute permission="dashboard.read"><Feed /></PermissionRoute>}
                />
                <Route
                  path="/dashboard/news"
                  element={<PermissionRoute permission="dashboard.read"><LegacyNewsRedirect /></PermissionRoute>}
                />
                <Route
                  path="/tasks"
                  element={<PermissionRoute permission="tasks.read"><Tasks /></PermissionRoute>}
                />
                <Route
                  path="/tickets"
                  element={<PermissionRoute permission="tickets.read"><Tickets /></PermissionRoute>}
                />
                {CHAT_FEATURE_ENABLED ? (
                  <Route
                    path="/chat"
                    element={<PermissionRoute permission="chat.read"><Chat /></PermissionRoute>}
                  />
                ) : null}
                <Route
                  path="/database"
                  element={<PermissionRoute permission="database.read"><Database /></PermissionRoute>}
                />
                <Route
                  path="/networks"
                  element={<PermissionRoute permission="networks.read"><Networks /></PermissionRoute>}
                />
                <Route
                  path="/networks/:branchId"
                  element={<PermissionRoute permission="networks.read"><Networks /></PermissionRoute>}
                />
                <Route path="/ad-users" element={<Navigate to="/admin/ad-users" replace />} />
                <Route
                  path="/vcs"
                  element={<PermissionRoute permission="vcs.read"><Vcs /></PermissionRoute>}
                />
                <Route
                  path="/mfu"
                  element={<PermissionRoute permission="mfu.read"><Mfu /></PermissionRoute>}
                />
                <Route
                  path="/computers"
                  element={<PermissionRoute permission="computers.read"><Computers /></PermissionRoute>}
                />
                <Route
                  path="/scan-center"
                  element={<PermissionRoute permission="scan.read"><ScanCenter /></PermissionRoute>}
                />
                <Route
                  path="/dlp"
                  element={<PermissionRoute adminOnly><FileEgress /></PermissionRoute>}
                />
                <Route
                  path="/file-egress"
                  element={<PermissionRoute adminOnly><FileEgress /></PermissionRoute>}
                />
                <Route
                  path="/statistics"
                  element={<PermissionRoute permission="statistics.read"><Statistics /></PermissionRoute>}
                />
                <Route
                  path="/mail"
                  element={<PermissionRoute permission="mail.access"><Mail /></PermissionRoute>}
                />
                <Route
                  path="/menu"
                  element={<MobileMenu />}
                />
                <Route
                  path="/address-book"
                  element={<PermissionRoute permission="address_book.read"><AddressBook /></PermissionRoute>}
                />
                <Route
                  path="/company-structure"
                  element={<PermissionRoute permission="company_structure.read"><CompanyStructure /></PermissionRoute>}
                />
                <Route
                  path="/warehouse-1c"
                  element={<PermissionRoute permission="warehouse_1c.read"><Warehouse1C /></PermissionRoute>}
                />
                <Route
                  path="/docflow"
                  element={<PermissionRoute permission="docflow.read"><Docflow /></PermissionRoute>}
                />
                <Route
                  path="/passwords"
                  element={<PermissionRoute permission="passwords.read"><Passwords /></PermissionRoute>}
                />
                <Route
                  path="/groups-access"
                  element={<PermissionRoute permission="groups_access.read"><GroupsAccess /></PermissionRoute>}
                />
                <Route
                  path="/my-files"
                  element={<PermissionRoute permission="my_files.read"><MyFiles /></PermissionRoute>}
                />
                <Route
                  path="/kb"
                  element={<PermissionRoute permission="kb.read"><KnowledgeBase /></PermissionRoute>}
                />
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings/:section?" element={<Settings />} />
                <Route path="/admin/:section?" element={<AdminAreaRoute><Admin /></AdminAreaRoute>} />
                </Route>
              </Route>

              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </Box>
    </AuthProvider>
  );
}

function AppRouterContent() {
  return <AuthenticatedAppShell />;
}

function App() {
  const rawBase = String(import.meta.env.BASE_URL || '/');
  const normalizedBase = rawBase === './' || rawBase === '.' ? '/' : rawBase;
  const routerBase = normalizedBase.endsWith('/') && normalizedBase.length > 1
    ? normalizedBase.slice(0, -1)
    : normalizedBase;

  return (
    <BrowserRouter
      basename={routerBase === '/' ? undefined : routerBase}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <AppRouterContent />
    </BrowserRouter>
  );
}

export default App;
