import { prepareNativeOfflineData } from './nativeOfflinePreparation';
import { readNativeOfflineCoverage, type NativeOfflineCoverageEntry } from './nativeOfflineCoverage';

export const NATIVE_OFFLINE_BACKGROUND_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const NATIVE_OFFLINE_INCOMPLETE_RETRY_INTERVAL_MS = 15 * 60 * 1000;

type NativeOfflineBackgroundRefreshOptions = {
  userId: number;
  permissions: readonly string[];
  isAdmin: boolean;
};

type NativeOfflineBackgroundRefreshResult = {
  preparedModules: string[];
  failedModules: string[];
};

const refreshRequests = new Map<number, Promise<NativeOfflineBackgroundRefreshResult>>();

function timestamp(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldRefresh(entry: NativeOfflineCoverageEntry | undefined, now: number): boolean {
  if (!entry) return true;
  const reference = entry.status === 'complete' ? entry.savedAt : entry.lastAttemptAt;
  const interval = entry.status === 'complete'
    ? NATIVE_OFFLINE_BACKGROUND_REFRESH_INTERVAL_MS
    : NATIVE_OFFLINE_INCOMPLETE_RETRY_INTERVAL_MS;
  const savedAt = timestamp(reference);
  return savedAt <= 0 || now - savedAt >= interval;
}

async function runBackgroundRefresh(
  options: NativeOfflineBackgroundRefreshOptions,
): Promise<NativeOfflineBackgroundRefreshResult> {
  const allowed = new Set(options.permissions.map((permission) => String(permission || '').trim()));
  const coverage = await readNativeOfflineCoverage(options.userId);
  const due = (moduleId: string) => shouldRefresh(coverage?.entries[moduleId], Date.now());
  const dashboardAllowed = allowed.has('dashboard.read');
  const preparationOptions = {
    userId: options.userId,
    isAdmin: options.isAdmin || allowed.has('tasks.manage_all'),
    dashboard: dashboardAllowed && due('dashboard'),
    feed: dashboardAllowed && due('feed'),
    tasks: allowed.has('tasks.read') && due('tasks'),
    chat: false,
    notifications: false,
    mail: allowed.has('mail.access') && due('mail'),
    docflow: allowed.has('docflow.read') && due('docflow'),
    addressBook: false,
    database: false,
    myFiles: allowed.has('my_files.read') && due('myFiles'),
    companyStructure: allowed.has('company_structure.read') && due('companyStructure'),
  };
  if (!Object.entries(preparationOptions).some(([key, value]) => (
    key !== 'userId' && key !== 'isAdmin' && value === true
  ))) {
    return { preparedModules: [], failedModules: [] };
  }
  return prepareNativeOfflineData(preparationOptions);
}

export async function refreshStaleNativeOfflineData(
  options: NativeOfflineBackgroundRefreshOptions,
): Promise<NativeOfflineBackgroundRefreshResult> {
  const userId = Number(options.userId || 0);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Authenticated user is required');
  const pending = refreshRequests.get(userId);
  if (pending) return pending;
  const request = runBackgroundRefresh({ ...options, userId }).finally(() => {
    if (refreshRequests.get(userId) === request) refreshRequests.delete(userId);
  });
  refreshRequests.set(userId, request);
  return request;
}
