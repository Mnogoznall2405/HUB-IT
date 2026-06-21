/**
 * Main App component with routing and authentication.
 */
import { Component, lazy, Suspense, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CHAT_FEATURE_ENABLED } from './lib/chatFeature';
import BrandedRouteLoader from './components/layout/BrandedRouteLoader';
import ScrollToTop from './components/layout/ScrollToTop';
import { canAccessAdminArea } from './components/account/accountNavigationConfig';
import { forceAppHardReload } from './lib/routeChunkRecovery';
import {
  applyChatPushDiagnostic,
  disableChatPushSubscription,
  getChatNotificationState,
  refreshChatNotificationState,
  requestChatPushSyncDrain,
  syncChatPushSubscription,
} from './lib/chatNotifications';
import ChatSocketBootstrap from './components/chat/ChatSocketBootstrap';
import { hasAnyAppPushPermission } from './lib/appPushPermissions';
import { syncAppBadge } from './lib/appBadge';
import {
  loadAddressBookRoute,
  loadChatRoute,
  loadComputersRoute,
  loadDashboardRoute,
  loadDatabaseRoute,
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
  loadSharedFileRoute,
  loadStatisticsRoute,
  loadTasksRoute,
  loadTicketsRoute,
  loadVcsRoute,
} from './lib/routeLoaders';

// Pages
const Login = lazy(loadLoginRoute);
const Dashboard = lazy(loadDashboardRoute);
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
const ScanCenter = lazy(loadScanCenterRoute);
const Mfu = lazy(loadMfuRoute);
const Mail = lazy(loadMailRoute);
const MobileMenu = lazy(loadMobileMenuRoute);
const Vcs = lazy(loadVcsRoute);
const KnowledgeBase = lazy(loadKnowledgeBaseRoute);
const AddressBook = lazy(loadAddressBookRoute);
const Passwords = lazy(loadPasswordsRoute);
const MyFiles = lazy(loadMyFilesRoute);
const SharedFile = lazy(loadSharedFileRoute);

const routePermissions = [
  { path: '/dashboard', permissions: ['dashboard.read'] },
  { path: '/tasks', permissions: ['tasks.read'] },
  { path: '/tickets', permissions: ['tickets.read'] },
  ...(CHAT_FEATURE_ENABLED ? [{ path: '/chat', permissions: ['chat.read'] }] : []),
  { path: '/database', permissions: ['database.read'] },
  { path: '/networks', permissions: ['networks.read'] },
  { path: '/mfu', permissions: ['mfu.read'] },
  { path: '/computers', permissions: ['computers.read'] },
  { path: '/scan-center', permissions: ['scan.read'] },
  { path: '/statistics', permissions: ['statistics.read'] },
  { path: '/kb', permissions: ['kb.read'] },
  { path: '/vcs', permissions: ['vcs.read'] },
  { path: '/mail', permissions: ['mail.access'] },
  { path: '/address-book', permissions: ['address_book.read'] },
  { path: '/passwords', permissions: ['passwords.read'] },
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

const AdminAreaRoute = ({ children }) => {
  const { hasPermission, user } = useAuth();
  if (canAccessAdminArea({ user, hasPermission })) {
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
        <ScrollToTop />
        <AppPushBootstrap />
        <ChatSocketBootstrap />
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
          <RouteErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/shared-files/:token" element={<SharedFile />} />

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
                  path="/passwords"
                  element={<PermissionRoute permission="passwords.read"><Passwords /></PermissionRoute>}
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
