import {
  clearRouteChunkRecoveryState,
  isRouteChunkLoadError,
  ROUTE_CHUNK_RELOAD_KEY,
} from './routeChunkRecovery';

const routePrefetchPromises = new Map();
const MY_FILES_GRANT_DEPLOY_KEY = 'hubit:my-files:grant-download-v2';

const ensureMyFilesGrantDeployReload = () => {
  if (typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage.getItem(MY_FILES_GRANT_DEPLOY_KEY) === '1') {
      return false;
    }
    window.sessionStorage.setItem(MY_FILES_GRANT_DEPLOY_KEY, '1');
    window.location.reload();
    return true;
  } catch {
    return false;
  }
};

const loadRouteWithReloadFallback = (loader) => (
  loader()
    .then((module) => {
      clearRouteChunkRecoveryState();
      return module;
    })
    .catch((error) => {
      if (typeof window !== 'undefined' && isRouteChunkLoadError(error)) {
        try {
          const alreadyRetried = window.sessionStorage.getItem(ROUTE_CHUNK_RELOAD_KEY) === '1';
          if (!alreadyRetried) {
            window.sessionStorage.setItem(ROUTE_CHUNK_RELOAD_KEY, '1');
            window.location.reload();
            return new Promise(() => {});
          }
        } catch {
          window.location.reload();
          return new Promise(() => {});
        }
      }
      throw error;
    })
);

const defineRouteLoader = (loader) => () => loadRouteWithReloadFallback(loader);

export const loadLoginRoute = defineRouteLoader(() => import('../pages/Login'));
export const loadDashboardRoute = defineRouteLoader(() => import('../pages/Dashboard'));
export const loadTasksRoute = defineRouteLoader(() => import('../pages/Tasks'));
export const loadTicketsRoute = defineRouteLoader(() => import('../pages/Tickets'));
export const loadChatRoute = defineRouteLoader(() => import('../pages/Chat'));
export const loadDatabaseRoute = defineRouteLoader(() => import('../pages/Database'));
export const loadNetworksRoute = defineRouteLoader(() => import('../pages/Networks'));
export const loadSettingsRoute = defineRouteLoader(() => import('../pages/Settings'));
export const loadProfileRoute = defineRouteLoader(() => import('../pages/Profile'));
export const loadAdminRoute = defineRouteLoader(() => import('../pages/Admin'));
export const loadStatisticsRoute = defineRouteLoader(() => import('../pages/Statistics'));
export const loadComputersRoute = defineRouteLoader(() => import('../pages/Computers'));
export const loadScanCenterRoute = defineRouteLoader(() => import('../pages/ScanCenter'));
export const loadMfuRoute = defineRouteLoader(() => import('../pages/Mfu'));
export const loadMailRoute = defineRouteLoader(() => import('../pages/Mail'));
export const loadMobileMenuRoute = defineRouteLoader(() => import('../pages/MobileMenu'));
export const loadVcsRoute = defineRouteLoader(() => import('../pages/Vcs'));
export const loadKnowledgeBaseRoute = defineRouteLoader(() => import('../pages/KnowledgeBase'));
export const loadAddressBookRoute = defineRouteLoader(() => import('../pages/AddressBook'));
export const loadPasswordsRoute = defineRouteLoader(() => import('../pages/Passwords'));
export const loadMyFilesRoute = defineRouteLoader(() => {
  if (ensureMyFilesGrantDeployReload()) {
    return new Promise(() => {});
  }
  return import('../pages/MyFiles');
});
export const loadSharedFileRoute = defineRouteLoader(() => import('../pages/SharedFile'));

const ROUTE_LOADERS = new Map([
  ['/login', loadLoginRoute],
  ['/dashboard', loadDashboardRoute],
  ['/tasks', loadTasksRoute],
  ['/tickets', loadTicketsRoute],
  ['/chat', loadChatRoute],
  ['/database', loadDatabaseRoute],
  ['/networks', loadNetworksRoute],
  ['/settings', loadSettingsRoute],
  ['/profile', loadProfileRoute],
  ['/admin', loadAdminRoute],
  ['/statistics', loadStatisticsRoute],
  ['/computers', loadComputersRoute],
  ['/scan-center', loadScanCenterRoute],
  ['/mfu', loadMfuRoute],
  ['/mail', loadMailRoute],
  ['/menu', loadMobileMenuRoute],
  ['/ad-users', loadAdminRoute],
  ['/vcs', loadVcsRoute],
  ['/kb', loadKnowledgeBaseRoute],
  ['/address-book', loadAddressBookRoute],
  ['/passwords', loadPasswordsRoute],
  ['/my-files', loadMyFilesRoute],
  ['/shared-files', loadSharedFileRoute],
]);

export const normalizeRouteLoaderPath = (path) => {
  const normalized = String(path || '').trim();
  if (!normalized) return '';
  if (normalized === '/settings' || normalized.startsWith('/settings/')) {
    return '/settings';
  }
  if (normalized === '/admin' || normalized.startsWith('/admin/')) {
    return '/admin';
  }
  if (normalized === '/networks' || normalized.startsWith('/networks/')) {
    return '/networks';
  }
  if (normalized === '/shared-files' || normalized.startsWith('/shared-files/')) {
    return '/shared-files';
  }
  return normalized;
};

export const prefetchRouteByPath = (path) => {
  const normalizedPath = normalizeRouteLoaderPath(path);
  const loader = ROUTE_LOADERS.get(normalizedPath);
  if (!loader) return Promise.resolve(null);

  const existingPromise = routePrefetchPromises.get(normalizedPath);
  if (existingPromise) return existingPromise;

  const nextPromise = loader().catch((error) => {
    routePrefetchPromises.delete(normalizedPath);
    throw error;
  });
  routePrefetchPromises.set(normalizedPath, nextPromise);
  return nextPromise;
};
