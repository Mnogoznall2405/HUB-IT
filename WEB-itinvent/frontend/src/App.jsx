/**
 * Main App component with routing and authentication.
 */
import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import './components/construction/useConstructionWorkLeaveGuard';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CHAT_FEATURE_ENABLED } from './lib/chatFeature';
import { ChatCallsContext, DISABLED_CHAT_CALLS } from './components/chat/calls/ChatCallsContext';
import BrandedRouteLoader from './components/layout/BrandedRouteLoader';
import ScrollToTop from './components/layout/ScrollToTop';
import { canAccessAdminArea } from './components/account/accountNavigationConfig';
import { forceAppHardReload, isRouteChunkLoadError } from './lib/routeChunkRecovery';
import {
  needsAboutOnboarding,
  peekPostAuthReturnPath,
  consumePostAuthReturnPath,
  rememberPostAuthReturnPath,
} from './lib/aboutOnboarding';
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
  loadMonitoringRoute,
  loadMyFilesRoute,
  loadMyFilesEditorRoute,
  loadNetworksRoute,
  loadKnowledgeBaseRoute,
  loadProfileRoute,
  loadAdminRoute,
  loadScanCenterRoute,
  loadVoiceVideoRoute,
  loadSettingsRoute,
  loadPasswordsRoute,
  loadGroupsAccessRoute,
  loadHelpRoute,
  loadSharedFileRoute,
  loadSharedFolderRoute,
  loadStatisticsRoute,
  loadTasksRoute,
  loadTicketsRoute,
  loadVcsRoute,
  loadWarehouse1CRoute,
  loadItPurchaseRequestsRoute,
  loadItObjectsRoute,
  loadItObjectDetailRoute,
  loadConstructionObjectsRoute,
  loadConstructionObjectDetailRoute,
  loadConstructionDirectionDetailRoute,
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
const ChatOpen = lazy(() => import('./pages/ChatOpen'));
const Database = lazy(loadDatabaseRoute);
const Networks = lazy(loadNetworksRoute);
const Settings = lazy(loadSettingsRoute);
const Profile = lazy(loadProfileRoute);
const Admin = lazy(loadAdminRoute);
const Statistics = lazy(loadStatisticsRoute);
const Computers = lazy(loadComputersRoute);
const FileEgress = lazy(loadFileEgressRoute);
const ScanCenter = lazy(loadScanCenterRoute);
const VoiceVideo = lazy(loadVoiceVideoRoute);
const Mfu = lazy(loadMfuRoute);
const Monitoring = lazy(loadMonitoringRoute);
const Mail = lazy(loadMailRoute);
const MobileMenu = lazy(loadMobileMenuRoute);
const Vcs = lazy(loadVcsRoute);
const KnowledgeBase = lazy(loadKnowledgeBaseRoute);
const AddressBook = lazy(loadAddressBookRoute);
const CompanyStructure = lazy(loadCompanyStructureRoute);
const Warehouse1C = lazy(loadWarehouse1CRoute);
const ItPurchaseRequests = lazy(loadItPurchaseRequestsRoute);
const ItObjects = lazy(loadItObjectsRoute);
const ItObjectDetail = lazy(loadItObjectDetailRoute);
const ConstructionObjects = lazy(loadConstructionObjectsRoute);
const ConstructionObjectDetail = lazy(loadConstructionObjectDetailRoute);
const ConstructionDirectionDetail = lazy(loadConstructionDirectionDetailRoute);
const Docflow = lazy(loadDocflowRoute);
const Passwords = lazy(loadPasswordsRoute);
const GroupsAccess = lazy(loadGroupsAccessRoute);
const MyFiles = lazy(loadMyFilesRoute);
const MyFilesEditor = lazy(loadMyFilesEditorRoute);
const SharedFile = lazy(loadSharedFileRoute);
const SharedFolder = lazy(loadSharedFolderRoute);
const Help = lazy(loadHelpRoute);
const SharedHubRouteLayout = lazy(() => import('./components/layout/MainLayoutRouteShell'));

const routePermissions = [
  { path: '/dashboard', permissions: ['dashboard.read'] },
  { path: '/feed', permissions: ['dashboard.read'] },
  { path: '/tasks', permissions: ['tasks.read'] },
  { path: '/tickets', permissions: ['tickets.read'] },
  ...(CHAT_FEATURE_ENABLED ? [{ path: '/chat', permissions: ['chat.read'] }] : []),
  { path: '/database', permissions: ['database.read'] },
  { path: '/networks', permissions: ['networks.read'] },
  { path: '/mfu', permissions: ['mfu.read'] },
  { path: '/monitoring', permissions: ['monitoring.read'] },
  { path: '/computers', permissions: ['computers.read'] },
  { path: '/scan-center', permissions: ['scan.read'] },
  { path: '/voice', permissions: ['voice.read'] },
  { path: '/dlp', adminOnly: true },
  { path: '/file-egress', adminOnly: true },
  { path: '/statistics', permissions: ['statistics.read'] },
  { path: '/kb', permissions: ['kb.read'] },
  { path: '/vcs', permissions: ['vcs.read'] },
  { path: '/mail', permissions: ['mail.access'] },
  { path: '/address-book', permissions: ['address_book.read'] },
  { path: '/warehouse-1c', permissions: ['warehouse_1c.read'] },
  { path: '/it/requests', permissions: ['warehouse_1c.it_requests.read'] },
  { path: '/it/objects', permissions: ['it_objects.read'] },
  { path: '/construction', permissions: ['construction.read'] },
  { path: '/docflow', permissions: ['docflow.read'] },
  { path: '/passwords', permissions: ['passwords.read', 'it_objects.read'] },
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
    // AD FS returns to /. Keep a portal chat recipient through that redirect;
    // ChatOpen consumes it after mounting, so StrictMode cannot lose it here.
    let portalChatReturn = '';
    try {
      const pending = peekPostAuthReturnPath();
      if (pending.startsWith('/chat/open#')) portalChatReturn = pending;
    } catch {
      // Ordinary routing remains available when browser storage is blocked.
    }
    return <Navigate to={portalChatReturn || resolveFirstAccessiblePath(hasPermission, user)} replace />;
  }

  return <Navigate to="/login" replace />;
};

const PostAuthNavigate = ({ destination, consumeReturnPath }) => {
  // The stored return path is consumed only when this navigation actually
  // commits. Login.jsx resolves the same destination via peek + assign for the
  // canonical-host reload case, so the two owners cannot race the key away from
  // each other.
  useEffect(() => {
    if (consumeReturnPath) consumePostAuthReturnPath();
  }, [consumeReturnPath]);
  return <Navigate to={destination} replace />;
};

const LoginRoute = () => {
  const { hasPermission, isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return <PageFallback />;
  }

  if (!isAuthenticated()) {
    return <Login />;
  }

  const needsOnboarding = needsAboutOnboarding(user);
  // Peek, not consume: the pending return path must stay readable until the
  // winning navigation commits (see PostAuthNavigate).
  const storedReturnPath = needsOnboarding ? '' : peekPostAuthReturnPath();
  return (
    <PostAuthNavigate
      destination={needsOnboarding
        ? '/about'
        : (storedReturnPath || resolveFirstAccessiblePath(hasPermission, user))}
      consumeReturnPath={Boolean(storedReturnPath)}
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

// «/monitoring?object=<ref>» открывает мониторинг одного объекта: сервер проверяет раздел объекта,
// поэтому достаточно права на «Объекты ИТ»; без параметра нужно право на весь мониторинг.
const MonitoringRoute = ({ children }) => {
  const location = useLocation();
  const objectScoped = new URLSearchParams(location.search).has('object');
  return <PermissionRoute permission={objectScoped ? 'it_objects.read' : 'monitoring.read'}>{children}</PermissionRoute>;
};

const AdminAreaRoute = ({ children }) => {
  const { hasPermission, user } = useAuth();
  if (canAccessAdminArea({ user, hasPermission })) {
    return children || <Outlet />;
  }
  return <Navigate to={resolveFirstAccessiblePath(hasPermission, user)} replace />;
};

// Post-auth infrastructure (push, realtime socket, desktop/mobile bridges)
// lives in a lazily imported module so the public login and shared-file pages
// neither run nor download it.
const AuthenticatedBootstraps = lazy(() => import('./components/layout/AuthenticatedBootstraps'));

const PostAuthGate = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated()) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
};

const PageFallback = () => (
  <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
    <BrandedRouteLoader label="Загружаем раздел..." sublabel="Подготавливаем интерфейс HUB-IT" />
  </Box>
);

export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, reloading: false, chunkError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, chunkError: isRouteChunkLoadError(error) };
  }

  componentDidCatch(error) {
    console.error('Route render failed:', error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.pathname !== this.props.pathname && this.state.hasError) {
      this.setState({ hasError: false, reloading: false, chunkError: false });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, reloading: false, chunkError: false });
  };

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
            <Box sx={{ fontSize: 22, fontWeight: 700, mb: 1 }}>
              {this.state.chunkError ? 'Нужно обновить экран' : 'Не удалось отобразить раздел'}
            </Box>
            <Box sx={{ color: 'rgba(255,255,255,0.62)', fontSize: 14, lineHeight: 1.7, mb: 2 }}>
              {this.state.chunkError
                ? 'Страница была открыта долго, и раздел не удалось догрузить. Нажмите «Обновить» — подтянется новая версия интерфейса.'
                : 'Раздел не удалось отобразить. Попробуйте ещё раз или откройте другой раздел.'}
            </Box>
            <button
              type="button"
              onClick={() => {
                if (this.state.chunkError) void this.handleHardReload();
                else this.handleRetry();
              }}
              disabled={this.state.reloading}
              className="min-h-12 rounded-[16px] !bg-cyan-200 px-5 text-sm font-semibold !text-zinc-950 disabled:opacity-60"
            >
              {this.state.chunkError
                ? (this.state.reloading ? 'Обновляем...' : 'Обновить')
                : 'Повторить'}
            </button>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

const LazyChatCallsProvider = lazy(() => import('./components/chat/calls/ChatCallsProvider'));

// The calls logic lives in a lazy chunk, but the context owner must be static:
// a `fallback={children}` Suspense would mount the whole route tree once under
// the fallback and again under the real provider. The shell provides
// DISABLED_CHAT_CALLS until the chunk reports its value via onContextValue.
const PostAuthChatCallsProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [callsValue, setCallsValue] = useState(null);
  if (!isAuthenticated()) return children;
  return (
    <ChatCallsContext.Provider value={callsValue || DISABLED_CHAT_CALLS}>
      {children}
      <Suspense fallback={null}>
        <LazyChatCallsProvider bare onContextValue={setCallsValue} />
      </Suspense>
    </ChatCallsContext.Provider>
  );
};

function AuthenticatedAppShell() {
  const { pathname } = useLocation();
  return (
    <AuthProvider>
      <ScrollToTop />
      <PostAuthGate>
        <Suspense fallback={null}>
          <AuthenticatedBootstraps />
        </Suspense>
      </PostAuthGate>
      <PostAuthChatCallsProvider>
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        <RouteErrorBoundary pathname={pathname}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<RootRoute />} />
              <Route path="/login" element={<LoginRoute />} />
              <Route path="/shared-files/:token" element={<SharedFile />} />
              <Route path="/shared-folders/:token" element={<SharedFolder />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/about" element={<About mode="onboarding" />} />
                <Route element={<AboutOnboardingRoute />}>
                <Route element={<SharedHubRouteLayout />}>
                  <Route
                    path="/dashboard"
                    element={<PermissionRoute permission="dashboard.read"><Dashboard /></PermissionRoute>}
                  />
                  <Route
                    path="/feed"
                    element={<PermissionRoute permission="dashboard.read"><Feed /></PermissionRoute>}
                  />
                  <Route
                    path="/tickets"
                    element={<PermissionRoute permission="tickets.read"><Tickets /></PermissionRoute>}
                  />
                  <Route
                    path="/tasks"
                    element={<PermissionRoute permission="tasks.read"><Tasks /></PermissionRoute>}
                  />
                  {CHAT_FEATURE_ENABLED ? (
                    <Route
                      path="/chat/open"
                      element={<PermissionRoute permission="chat.read"><ChatOpen /></PermissionRoute>}
                    />
                  ) : null}
                  {CHAT_FEATURE_ENABLED ? (
                    <Route
                      path="/chat"
                      handle={{ hubBare: true }}
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
                    path="/vcs"
                    element={<PermissionRoute permission="vcs.read"><Vcs /></PermissionRoute>}
                  />
                  <Route
                    path="/mfu"
                    element={<PermissionRoute permission="mfu.read"><Mfu /></PermissionRoute>}
                  />
                  <Route
                    path="/monitoring"
                    element={<MonitoringRoute><Monitoring /></MonitoringRoute>}
                  />
                  <Route
                    path="/computers"
                    element={<PermissionRoute permission="computers.read"><Computers /></PermissionRoute>}
                  />
                  <Route
                    path="/scan-center"
                    handle={{ hubBare: true }}
                    element={<PermissionRoute permission="scan.read"><ScanCenter /></PermissionRoute>}
                  />
                  <Route
                    path="/voice"
                    handle={{ hubBare: true }}
                    element={<PermissionRoute permission="voice.read"><VoiceVideo /></PermissionRoute>}
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
                    path="/mail/compose"
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
                    path="/it/requests/:requestRef?"
                    element={<PermissionRoute permission="warehouse_1c.it_requests.read"><ItPurchaseRequests /></PermissionRoute>}
                  />
                  <Route
                    path="/it/objects"
                    element={<PermissionRoute permission="it_objects.read"><ItObjects /></PermissionRoute>}
                  />
                  <Route
                    path="/it/objects/:objectRef"
                    element={<PermissionRoute permission="it_objects.read"><ItObjectDetail /></PermissionRoute>}
                  />
                  <Route
                    path="/construction"
                    element={<PermissionRoute permission="construction.read"><ConstructionObjects /></PermissionRoute>}
                  />
                  <Route
                    path="/construction/objects/:objectId"
                    element={<PermissionRoute permission="construction.read"><ConstructionObjectDetail /></PermissionRoute>}
                  />
                  <Route
                    path="/construction/objects/:objectId/directions/:groupRef"
                    element={<PermissionRoute permission="construction.read"><ConstructionDirectionDetail /></PermissionRoute>}
                  />
                  <Route
                    path="/construction/objects/:objectId/directions/:groupRef/requests/:requestRef"
                    element={<PermissionRoute permission="construction.read"><ConstructionDirectionDetail /></PermissionRoute>}
                  />
                  <Route
                    path="/construction/objects/:objectId/requests/:requestRef"
                    element={<PermissionRoute permission="construction.read"><ConstructionObjectDetail /></PermissionRoute>}
                  />
                  <Route
                    path="/docflow"
                    element={<PermissionRoute permission="docflow.read"><Docflow /></PermissionRoute>}
                  />
                  <Route
                    path="/passwords"
                    element={<PermissionRoute permissions={['passwords.read', 'it_objects.read']}><Passwords /></PermissionRoute>}
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
                    path="/kb/manage"
                    element={<PermissionRoute permission="kb.write"><KnowledgeBase /></PermissionRoute>}
                  />
                  <Route path="/help" element={<Help />} />
                  <Route path="/profile" handle={{ hubBare: true }} element={<Profile />} />
                  <Route path="/settings/:section?" handle={{ hubBare: true }} element={<Settings />} />
                  <Route path="/admin/:section?" handle={{ hubBare: true }} element={<AdminAreaRoute><Admin /></AdminAreaRoute>} />
                </Route>
                <Route
                  path="/dashboard/news"
                  element={<PermissionRoute permission="dashboard.read"><LegacyNewsRedirect /></PermissionRoute>}
                />
                <Route path="/ad-users" element={<Navigate to="/admin/ad-users" replace />} />
                <Route
                  path="/my-files/edit/:fileId"
                  element={<PermissionRoute permission="my_files.read"><MyFilesEditor /></PermissionRoute>}
                />
                <Route path="/kb" element={<Navigate to="/help" replace />} />
                </Route>
              </Route>

              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </Box>
      </PostAuthChatCallsProvider>
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
    >
      <AppRouterContent />
    </BrowserRouter>
  );
}

export default App;
