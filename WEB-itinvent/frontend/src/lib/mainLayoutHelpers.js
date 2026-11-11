export const normalizeDbId = (value) => String(value ?? '').trim();

const CONNECTION_RESTORED_MARKER_MAX_AGE_MS = 15_000;
const CONNECTION_RESTORED_STORAGE_KEY = 'hubit:connection-restored-at';

export const consumeConnectionRestoredMarker = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.onLine) return false;
  try {
    const restoredAt = Number(window.sessionStorage.getItem(CONNECTION_RESTORED_STORAGE_KEY) || 0);
    window.sessionStorage.removeItem(CONNECTION_RESTORED_STORAGE_KEY);
    return restoredAt > 0
      && Date.now() >= restoredAt
      && Date.now() - restoredAt <= CONNECTION_RESTORED_MARKER_MAX_AGE_MS;
  } catch {
    return false;
  }
};

export const persistConnectionRestoredMarker = () => {
  try {
    window.sessionStorage.setItem(CONNECTION_RESTORED_STORAGE_KEY, String(Date.now()));
  } catch {
    // Session storage is optional in hardened WebViews and private browser modes.
  }
};

export const clearConnectionRestoredMarker = () => {
  try {
    window.sessionStorage.removeItem(CONNECTION_RESTORED_STORAGE_KEY);
  } catch {
    // Session storage is optional in hardened WebViews and private browser modes.
  }
};

export const formatOfflineLastSync = (value) => {
  const timestamp = Number(value || 0);
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
};

export const groupItemsByRelativeDate = (items, dateKey) => {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  const groups = { today: [], yesterday: [], earlier: [] };

  (Array.isArray(items) ? items : []).forEach((item) => {
    const rawValue = String(item?.[dateKey] || '').trim();
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      groups.earlier.push(item);
      return;
    }
    if (parsed.toDateString() === todayStr) groups.today.push(item);
    else if (parsed.toDateString() === yesterdayStr) groups.yesterday.push(item);
    else groups.earlier.push(item);
  });

  return [
    { key: 'today', label: 'Сегодня', items: groups.today },
    { key: 'yesterday', label: 'Вчера', items: groups.yesterday },
    { key: 'earlier', label: 'Ранее', items: groups.earlier },
  ].filter((section) => section.items.length > 0);
};
