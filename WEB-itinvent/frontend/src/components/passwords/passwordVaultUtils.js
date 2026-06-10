export const PASSWORD_HIDE_MS = 30_000;
export const UNLOCK_SESSION_MS = 5 * 60 * 1000;
export const VAULT_UNLOCK_STORAGE_PREFIX = 'itinvent_password_vault_unlock_until';

export const normalizeText = (value) => String(value ?? '').trim();

export const normalizeEntry = (entry) => ({
  id: normalizeText(entry?.id),
  group: normalizeText(entry?.group),
  tags: Array.isArray(entry?.tags) ? entry.tags.map(normalizeText).filter(Boolean) : [],
  login: normalizeText(entry?.login),
  description: normalizeText(entry?.description),
  is_archived: Boolean(entry?.is_archived),
  created_at: entry?.created_at || null,
  updated_at: entry?.updated_at || null,
  created_by: entry?.created_by || '',
  updated_by: entry?.updated_by || '',
  password_configured: entry?.password_configured !== false,
});

export const isUnlockedUntilActive = (value) => {
  const raw = normalizeText(value);
  if (!raw) return false;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
};

export const pickActiveUnlockedUntil = (...candidates) => {
  let bestValue = null;
  let bestTs = 0;
  candidates.forEach((candidate) => {
    const raw = normalizeText(candidate);
    if (!raw) return;
    const parsed = new Date(raw);
    const ts = parsed.getTime();
    if (Number.isNaN(ts) || ts <= Date.now()) return;
    if (ts > bestTs) {
      bestTs = ts;
      bestValue = raw;
    }
  });
  return bestValue;
};

export const isVaultUnlockRequiredError = (error) => {
  const status = Number(error?.response?.status || 0);
  const detail = normalizeText(error?.response?.data?.detail).toLowerCase();
  return status === 403 && /unlock is required|разблокир|требуется.*2fa|подтвердите.*2fa/i.test(detail);
};

export const isVaultDecryptError = (error) => {
  const detail = normalizeText(error?.response?.data?.detail).toLowerCase();
  return /расшифр|decrypt|password_vault_key/i.test(detail);
};

export const buildVaultUnlockStorageKey = (userId) => `${VAULT_UNLOCK_STORAGE_PREFIX}:${normalizeText(userId) || 'anonymous'}`;

export const readStoredVaultUnlockUntil = (userId) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(buildVaultUnlockStorageKey(userId));
    return isUnlockedUntilActive(raw) ? normalizeText(raw) : null;
  } catch {
    return null;
  }
};

export const writeStoredVaultUnlockUntil = (userId, value) => {
  if (typeof window === 'undefined') return;
  const storageKey = buildVaultUnlockStorageKey(userId);
  try {
    if (isUnlockedUntilActive(value)) {
      window.sessionStorage.setItem(storageKey, normalizeText(value));
    } else {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // ignore quota / private mode errors
  }
};

export const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const buildGroupCounts = (entries = []) => {
  const counts = new Map();
  entries.forEach((entry) => {
    const group = normalizeText(entry?.group) || 'Без группы';
    counts.set(group, (counts.get(group) || 0) + 1);
  });
  return counts;
};

export const formatUnlockRemainingLabel = (remainingMs) => {
  const totalSeconds = Math.floor(Math.max(0, Number(remainingMs || 0)) / 1000);
  if (totalSeconds <= 0) return '';
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};
