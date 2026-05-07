import { pushNavigationDebugEntry } from './navigationDebug';

const routePrefetchPromises = new Map();
const ROUTE_CHUNK_RELOAD_KEY = 'itinvent:route-chunk-reload-attempted';

const isRouteChunkLoadError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module')
    || message.includes('importing a module script failed')
    || message.includes('loading chunk')
    || message.includes('chunkloaderror')
  );
};

export const loadRouteWithReloadFallback = (loader, { reloadOnChunkError = true } = {}) => (
  loader()
    .then((module) => {
      pushNavigationDebugEntry('route-loader:loaded', {
        reloadOnChunkError: Boolean(reloadOnChunkError),
      });
      try {
        window.sessionStorage.removeItem(ROUTE_CHUNK_RELOAD_KEY);
      } catch {
        // Ignore storage failures.
      }
      return module;
    })
    .catch((error) => {
      const chunkLoadError = isRouteChunkLoadError(error);
      pushNavigationDebugEntry('route-loader:error', {
        reloadOnChunkError: Boolean(reloadOnChunkError),
        chunkLoadError,
        message: String(error?.message || error),
      });
      if (typeof window !== 'undefined' && reloadOnChunkError && chunkLoadError) {
        try {
          const alreadyRetried = window.sessionStorage.getItem(ROUTE_CHUNK_RELOAD_KEY) === '1';
          pushNavigationDebugEntry('route-loader:chunk-reload', {
            alreadyRetried,
          });
          if (!alreadyRetried) {
            window.sessionStorage.setItem(ROUTE_CHUNK_RELOAD_KEY, '1');
            window.location.reload();
            return new Promise(() => {});
          }
        } catch {
          pushNavigationDebugEntry('route-loader:chunk-reload:storage-error');
          window.location.reload();
          return new Promise(() => {});
        }
      }
      throw error;
    })
);

const defineRouteLoader = (loader) => () => loadRouteWithReloadFallback(loader);

const ROUTE_IMPORTERS = new Map([
  ['/login', () => import('../pages/Login')],
  ['/dashboard', () => import('../pages/Dashboard')],
  ['/tasks', () => import('../pages/Tasks')],
  ['/chat', () => import('../pages/Chat')],
  ['/database', () => import('../pages/Database')],
  ['/networks', () => import('../pages/Networks')],
  ['/settings', () => import('../pages/Settings')],
  ['/statistics', () => import('../pages/Statistics')],
  ['/computers', () => import('../pages/Computers')],
  ['/scan-center', () => import('../pages/ScanCenter')],
  ['/mfu', () => import('../pages/Mfu')],
  ['/mail', () => import('../pages/Mail')],
  ['/ad-users', () => import('../pages/AdUsers')],
  ['/vcs', () => import('../pages/Vcs')],
  ['/kb', () => import('../pages/KnowledgeBase')],
]);

export const loadLoginRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/login'));
export const loadDashboardRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/dashboard'));
export const loadTasksRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/tasks'));
export const loadChatRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/chat'));
export const loadDatabaseRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/database'));
export const loadNetworksRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/networks'));
export const loadSettingsRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/settings'));
export const loadStatisticsRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/statistics'));
export const loadComputersRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/computers'));
export const loadScanCenterRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/scan-center'));
export const loadMfuRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/mfu'));
export const loadMailRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/mail'));
export const loadAdUsersRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/ad-users'));
export const loadVcsRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/vcs'));
export const loadKnowledgeBaseRoute = defineRouteLoader(ROUTE_IMPORTERS.get('/kb'));

const ROUTE_LOADERS = new Map([
  ['/login', loadLoginRoute],
  ['/dashboard', loadDashboardRoute],
  ['/tasks', loadTasksRoute],
  ['/chat', loadChatRoute],
  ['/database', loadDatabaseRoute],
  ['/networks', loadNetworksRoute],
  ['/settings', loadSettingsRoute],
  ['/statistics', loadStatisticsRoute],
  ['/computers', loadComputersRoute],
  ['/scan-center', loadScanCenterRoute],
  ['/mfu', loadMfuRoute],
  ['/mail', loadMailRoute],
  ['/ad-users', loadAdUsersRoute],
  ['/vcs', loadVcsRoute],
  ['/kb', loadKnowledgeBaseRoute],
]);

export const normalizeRouteLoaderPath = (path) => {
  const normalized = String(path || '').trim();
  if (!normalized) return '';
  if (normalized === '/networks' || normalized.startsWith('/networks/')) {
    return '/networks';
  }
  return normalized;
};

export const prefetchRouteByPath = (path) => {
  const normalizedPath = normalizeRouteLoaderPath(path);
  if (!ROUTE_IMPORTERS.has(normalizedPath)) {
    pushNavigationDebugEntry('route-prefetch:skip:unknown', {
      requestedPath: String(path || ''),
      normalizedPath,
    });
    return Promise.resolve(null);
  }

  const existingPromise = routePrefetchPromises.get(normalizedPath);
  if (existingPromise) {
    pushNavigationDebugEntry('route-prefetch:reuse', { normalizedPath });
    return existingPromise;
  }

  // Do not dynamically import here. Vite can emit a global preload error for a
  // failed speculative import, and the app-level chunk recovery would reload the
  // still-current route before user navigation is applied.
  pushNavigationDebugEntry('route-prefetch:noop', { normalizedPath });
  const nextPromise = Promise.resolve(null);
  routePrefetchPromises.set(normalizedPath, nextPromise);
  return nextPromise;
};

export const getStartupRoutePrefetchPath = (path) => {
  const normalizedPath = normalizeRouteLoaderPath(path);
  if (!normalizedPath || normalizedPath === '/') return '';
  return ROUTE_LOADERS.has(normalizedPath) ? normalizedPath : '';
};

export const prefetchStartupRoute = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const path = getStartupRoutePrefetchPath(window.location?.pathname || '');
  return path ? prefetchRouteByPath(path) : Promise.resolve(null);
};
