const CACHE_PREFIX = 'docflow:tasks:v1:';
export const DOCFLOW_TASKS_CACHE_TTL_MS = 8 * 60 * 1000;
/** Пока кэш «свежий» — не дергаем 1С; после — stale-while-revalidate. */
export const DOCFLOW_TASKS_CACHE_FRESH_MS = 45 * 1000;

function encodePart(value) {
  return encodeURIComponent(String(value || '').trim());
}

export function buildDocflowTasksCacheKey({ login, scope, search }) {
  return `${CACHE_PREFIX}${encodePart(login)}:${encodePart(scope || 'inbox')}:${encodePart(search || '')}`;
}

function readStorage() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function isDocflowTasksCacheFresh(cached, now = Date.now(), freshMs = DOCFLOW_TASKS_CACHE_FRESH_MS) {
  const savedAt = Number(cached?.savedAt || 0);
  if (!savedAt) return false;
  return now - savedAt <= freshMs;
}

export function readDocflowTasksCache({ login, scope, search, now = Date.now(), ttlMs = DOCFLOW_TASKS_CACHE_TTL_MS }) {
  const storage = readStorage();
  if (!storage) return null;
  const key = buildDocflowTasksCacheKey({ login, scope, search });
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed?.savedAt || 0);
    if (!savedAt || now - savedAt > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      truncated: Boolean(parsed.truncated),
      as_of: String(parsed.as_of || ''),
      savedAt,
    };
  } catch {
    try { storage.removeItem(key); } catch { /* ignore */ }
    return null;
  }
}

export function writeDocflowTasksCache({ login, scope, search, items, truncated, as_of, now = Date.now() }) {
  const storage = readStorage();
  if (!storage) return false;
  const key = buildDocflowTasksCacheKey({ login, scope, search });
  try {
    storage.setItem(key, JSON.stringify({
      items: Array.isArray(items) ? items : [],
      truncated: Boolean(truncated),
      as_of: String(as_of || ''),
      savedAt: now,
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearDocflowTasksCacheByLogin(login) {
  const storage = readStorage();
  if (!storage) return 0;
  const prefix = `${CACHE_PREFIX}${encodePart(login)}:`;
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => {
    try { storage.removeItem(key); } catch { /* ignore */ }
  });
  return keys.length;
}

export function clearAllDocflowTasksCache() {
  const storage = readStorage();
  if (!storage) return 0;
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => {
    try { storage.removeItem(key); } catch { /* ignore */ }
  });
  return keys.length;
}

/** History scopes hit DM withExecuted=true (multi‑MB for busy 1C users). */
export function isHeavyDocflowTasksScope(scope) {
  const normalized = String(scope || '').trim().toLowerCase();
  return normalized === 'completed' || normalized === 'all';
}

function sameTaskRef(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

/**
 * After a task is executed in 1С: drop it from inbox cache and (if present)
 * prepend into completed cache — without refetching the heavy history list.
 */
export function patchDocflowTasksCacheAfterCompletion({
  login,
  task,
  search = '',
  now = Date.now(),
}) {
  const ref = String(task?.ref || '').trim();
  if (!login || !ref) return { inbox: false, completed: false };

  let inboxPatched = false;
  const inboxSearches = new Set(['', String(search || '').trim()]);
  inboxSearches.forEach((q) => {
    const cached = readDocflowTasksCache({ login, scope: 'inbox', search: q, now });
    if (!cached) return;
    const nextItems = (cached.items || []).filter((item) => !sameTaskRef(item?.ref, ref));
    if (nextItems.length === (cached.items || []).length) return;
    writeDocflowTasksCache({
      login,
      scope: 'inbox',
      search: q,
      items: nextItems,
      truncated: cached.truncated,
      as_of: new Date(now).toISOString(),
      now,
    });
    inboxPatched = true;
  });

  let completedPatched = false;
  const completed = readDocflowTasksCache({ login, scope: 'completed', search: '', now });
  if (completed) {
    const without = (completed.items || []).filter((item) => !sameTaskRef(item?.ref, ref));
    writeDocflowTasksCache({
      login,
      scope: 'completed',
      search: '',
      items: [task, ...without].slice(0, 50),
      truncated: completed.truncated,
      as_of: new Date(now).toISOString(),
      now,
    });
    completedPatched = true;
  }

  // "all" mixes active+history — drop so the next open is an explicit user refresh.
  const storage = readStorage();
  if (storage) {
    try {
      storage.removeItem(buildDocflowTasksCacheKey({ login, scope: 'all', search: '' }));
    } catch { /* ignore */ }
  }

  return { inbox: inboxPatched, completed: completedPatched };
}
