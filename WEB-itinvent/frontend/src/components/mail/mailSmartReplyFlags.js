const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export const MAIL_SMART_REPLY_CHIPS_STORAGE_KEY = 'mail_smart_reply_chips';

function parseFlag(raw, defaultValue = true) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return Boolean(defaultValue);
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  return Boolean(defaultValue);
}

export function isMailSmartReplyChipsEnabled({
  storage,
  envValue = import.meta.env.VITE_MAIL_SMART_REPLY_CHIPS,
} = {}) {
  const resolvedStorage = storage === undefined
    ? (typeof localStorage === 'undefined' ? null : localStorage)
    : storage;
  try {
    const stored = resolvedStorage?.getItem?.(MAIL_SMART_REPLY_CHIPS_STORAGE_KEY);
    if (stored != null && String(stored).trim() !== '') {
      return parseFlag(stored, true);
    }
  } catch {
    // ignore storage access errors
  }
  return parseFlag(envValue, true);
}
