const routePrefetchPromises = new Map();

export const loadLoginRoute = () => import('../pages/Login');
export const loadDashboardRoute = () => import('../pages/Dashboard');
export const loadTasksRoute = () => import('../pages/Tasks');
export const loadChatRoute = () => import('../pages/Chat');
export const loadDatabaseRoute = () => import('../pages/Database');
export const loadNetworksRoute = () => import('../pages/Networks');
export const loadSettingsRoute = () => import('../pages/Settings');
export const loadStatisticsRoute = () => import('../pages/Statistics');
export const loadComputersRoute = () => import('../pages/Computers');
export const loadScanCenterRoute = () => import('../pages/ScanCenter');
export const loadMfuRoute = () => import('../pages/Mfu');
export const loadMailRoute = () => import('../pages/Mail');
export const loadAdUsersRoute = () => import('../pages/AdUsers');
export const loadVcsRoute = () => import('../pages/Vcs');
export const loadKnowledgeBaseRoute = () => import('../pages/KnowledgeBase');

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
