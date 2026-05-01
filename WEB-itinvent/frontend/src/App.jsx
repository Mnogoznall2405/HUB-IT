/**
 * Main App component with routing and authentication.
 */
import { Component, lazy, Suspense, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CHAT_FEATURE_ENABLED } from './lib/chatFeature';
import BrandedRouteLoader from './components/layout/BrandedRouteLoader';
import {
  applyChatPushDiagnostic,
  disableChatPushSubscription,
  getChatNotificationState,
  refreshChatNotificationState,
  requestChatPushSyncDrain,
  syncChatPushSubscription,
} from './lib/chatNotifications';
import { hasAnyAppPushPermission } from './lib/appPushPermissions';
import { syncAppBadge } from './lib/appBadge';
import {
  loadAdUsersRoute,
  loadChatRoute,
  loadComputersRoute,
  loadDashboardRoute,
  loadDatabaseRoute,
  loadLoginRoute,
  loadMailRoute,
  loadMfuRoute,
  loadNetworksRoute,
  loadKnowledgeBaseRoute,
  loadScanCenterRoute,
  loadSettingsRoute,
  loadStatisticsRoute,
  loadTasksRoute,
  loadVcsRoute,
} from './lib/routeLoaders';

// Pages
const Login = lazy(loadLoginRoute);
const Dashboard = lazy(loadDashboardRoute);
const Tasks = lazy(loadTasksRoute);
const Chat = lazy(loadChatRoute);
const Database = lazy(loadDatabaseRoute);
const Networks = lazy(loadNetworksRoute);
const Settings = lazy(loadSettingsRoute);
const Statistics = lazy(loadStatisticsRoute);
const Computers = lazy(loadComputersRoute);
const ScanCenter = lazy(loadScanCenterRoute);
const Mfu = lazy(loadMfuRoute);
const Mail = lazy(loadMailRoute);
const AdUsers = lazy(loadAdUsersRoute);
const Vcs = lazy(loadVcsRoute);
const KnowledgeBase = lazy(loadKnowledgeBaseRoute);

const routePermissions = [
  { path: '/dashboard', permissions: ['dashboard.read'] },
  { path: '/tasks', permissions: ['tasks.read'] },
  ...(CHAT_FEATURE_ENABLED ? [{ path: '/chat', permissions: ['chat.read'] }] : []),
  { path: '/database', permissions: ['database.read'] },
  { path: '/networks', permissions: ['networks.read'] },
  { path: '/mfu', permissions: ['database.read'] },
  { path: '/computers', permissions: ['computers.read'] },
  { path: '/scan-center', permissions: ['scan.read'] },
  { path: '/statistics', permissions: ['statistics.read'] },
  { path: '/kb', permissions: ['kb.read'] },
  { path: '/settings', permissions: ['settings.read'] },
  { path: '/ad-users', adminOnly: true },
  { path: '/vcs', permissions: ['vcs.read'] },
  { path: '/mail', permissions: ['mail.access'] },
];

const canAccessAny = (hasPermission, permissions = []) => (
  permissions.some((permission) => hasPermission(permission))
);

const isAdminUser = (user) => String(user?.role || '').trim().toLowerCase() === 'admin';

const canAccessRoute = (hasPermission, user, route) => {
  if (route?.adminOnly) {
    return isAdminUser(user);
  }
  return canAccessAny(hasPermission, route?.permissions || []);
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

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>Loading...</Box>;
  }

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  return children || <Outlet />;
};

const HomeRedirect = () => {
  const { hasPermission, user } = useAuth();
  return <Navigate to={resolveFirstAccessiblePath(hasPermission, user)} replace />;
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

const AppPushBootstrap = () => {
  const { user, hasPermission } = useAuth();
  const location = useLocation();
  const hasAppPushPermission = hasAnyAppPushPermission(hasPermission, {
    chatFeatureEnabled: CHAT_FEATURE_ENABLED,
  });
  const isChatRoute = String(location?.pathname || '').startsWith('/chat');

  const runPushSync = useCallback((force = false) => {
    if (!hasAppPushPermission || !user) {
      void disableChatPushSubscription({ removeServer: Boolean(user) }).catch(() => {
        refreshChatNotificationState();
      });
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
      currentState?.enabled
      && currentState?.permission === 'granted'
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
      if (!currentState?.enabled) return;
      if (currentState?.permission !== 'granted') return;
      if (currentState?.pushSubscribed && !currentState?.pendingResubscribe) return;
      runPushSync(Boolean(currentState?.pendingResubscribe));
    }, 30_000);

    return () => {
      window.clearInterval(retryTimer);
    };
  }, [hasAppPushPermission, runPushSync, user]);

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
  }, [schedulePushSync]);

  return null;
};

const PageFallback = () => (
  <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
    <BrandedRouteLoader label="Загружаем раздел..." sublabel="Подготавливаем интерфейс HUB-IT" />
  </Box>
);

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Route render failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            minHeight: '100vh',
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
              Приложение было открыто долго, и раздел не удалось догрузить.
            </Box>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-12 rounded-[16px] !bg-cyan-200 px-5 text-sm font-semibold !text-zinc-950"
            >
              Обновить
            </button>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
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
      <AuthProvider>
        <AppPushBootstrap />
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <RouteErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<HomeRedirect />} />
                <Route
                  path="/dashboard"
                  element={<PermissionRoute permission="dashboard.read"><Dashboard /></PermissionRoute>}
                />
                <Route
                  path="/tasks"
                  element={<PermissionRoute permission="tasks.read"><Tasks /></PermissionRoute>}
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
                <Route
                  path="/ad-users"
                  element={<PermissionRoute adminOnly><AdUsers /></PermissionRoute>}
                />
                <Route
                  path="/vcs"
                  element={<PermissionRoute permission="vcs.read"><Vcs /></PermissionRoute>}
                />
                <Route
                  path="/mfu"
                  element={<PermissionRoute permission="database.read"><Mfu /></PermissionRoute>}
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
                  path="/statistics"
                  element={<PermissionRoute permission="statistics.read"><Statistics /></PermissionRoute>}
                />
                <Route
                  path="/mail"
                  element={<PermissionRoute permission="mail.access"><Mail /></PermissionRoute>}
                />
                <Route
                  path="/kb"
                  element={<PermissionRoute permission="kb.read"><KnowledgeBase /></PermissionRoute>}
                />
                <Route
                  path="/settings"
                  element={<PermissionRoute permission="settings.read"><Settings /></PermissionRoute>}
                />
              </Route>

              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </Suspense>
          </RouteErrorBoundary>
        </Box>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
