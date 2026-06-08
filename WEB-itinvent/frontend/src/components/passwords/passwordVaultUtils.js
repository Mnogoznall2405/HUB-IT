export const PASSWORD_HIDE_MS = 30_000;
export const UNLOCK_SESSION_MS = 5 * 60 * 1000;

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
