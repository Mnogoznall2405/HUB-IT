export const DATABASE_BRANCH_FILTERS_CACHE_KEY = 'database_branch_filters';
const PERSIST_DEBOUNCE_MS = 400;

let persistTimerId = null;
let pendingPersistFn = null;

export function normalizeDatabaseBranchFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result = {};
  Object.entries(value).forEach(([dbId, branchName]) => {
    const key = String(dbId || '').trim();
    if (!key) return;
    result[key] = String(branchName ?? '').trim();
  });
  return result;
}

export function readCachedBranchFilters() {
  try {
    const raw = localStorage.getItem(DATABASE_BRANCH_FILTERS_CACHE_KEY);
    if (!raw) return {};
    return normalizeDatabaseBranchFilters(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeCachedBranchFilters(filters) {
  const normalized = normalizeDatabaseBranchFilters(filters);
  localStorage.setItem(DATABASE_BRANCH_FILTERS_CACHE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getBranchForDatabase(dbId) {
  const key = String(dbId || '').trim();
  if (!key) return '';
  return String(readCachedBranchFilters()[key] || '').trim();
}

export function setBranchForDatabase(dbId, branchName) {
  const key = String(dbId || '').trim();
  if (!key) return readCachedBranchFilters();

  const next = { ...readCachedBranchFilters() };
  next[key] = String(branchName ?? '').trim();
  return writeCachedBranchFilters(next);
}

export function mergeServerBranchFilters(serverMap) {
  return writeCachedBranchFilters(serverMap);
}

export function resolveValidatedBranch(branchName, branches = []) {
  const normalizedBranch = String(branchName || '').trim();
  if (!normalizedBranch) return '';

  const available = (Array.isArray(branches) ? branches : [])
    .map((item) => String(item?.BRANCH_NAME || item?.branch_name || '').trim())
    .filter(Boolean);

  return available.includes(normalizedBranch) ? normalizedBranch : '';
}

export function schedulePersistBranchFilters(patchFn, filters) {
  pendingPersistFn = patchFn;
  const payload = normalizeDatabaseBranchFilters(filters);

  if (persistTimerId != null) {
    clearTimeout(persistTimerId);
  }

  persistTimerId = setTimeout(() => {
    persistTimerId = null;
    const fn = pendingPersistFn;
    pendingPersistFn = null;
    if (!fn) return;
    void fn({ database_branch_filters: payload }).catch((error) => {
      console.error('Failed to persist database branch filters:', error);
    });
  }, PERSIST_DEBOUNCE_MS);
}

export function flushPersistBranchFilters() {
  if (persistTimerId != null) {
    clearTimeout(persistTimerId);
    persistTimerId = null;
  }
  pendingPersistFn = null;
}

export default {
  DATABASE_BRANCH_FILTERS_CACHE_KEY,
  normalizeDatabaseBranchFilters,
  readCachedBranchFilters,
  writeCachedBranchFilters,
  getBranchForDatabase,
  setBranchForDatabase,
  mergeServerBranchFilters,
  resolveValidatedBranch,
  schedulePersistBranchFilters,
  flushPersistBranchFilters,
};
