const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export const MAIL_HTML_SANDBOX_STORAGE_KEY = 'mail_html_sandbox';

function parseFlag(raw, defaultValue = false) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return Boolean(defaultValue);
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  return Boolean(defaultValue);
}

export function isMailHtmlSandboxEnabled({
  storage,
  envValue = import.meta.env.VITE_MAIL_HTML_SANDBOX,
} = {}) {
  const resolvedStorage = storage === undefined
    ? (typeof localStorage === 'undefined' ? null : localStorage)
    : storage;
  try {
    const stored = resolvedStorage?.getItem?.(MAIL_HTML_SANDBOX_STORAGE_KEY);
    if (stored != null && String(stored).trim() !== '') {
      return parseFlag(stored, false);
    }
  } catch {
    // ignore storage access errors
  }
  return parseFlag(envValue, false);
}

export function setMailHtmlSandboxEnabled(enabled, { storage } = {}) {
  const resolvedStorage = storage === undefined
    ? (typeof localStorage === 'undefined' ? null : localStorage)
    : storage;
  const next = Boolean(enabled);
  try {
    resolvedStorage?.setItem?.(MAIL_HTML_SANDBOX_STORAGE_KEY, next ? 'true' : 'false');
  } catch {
    // ignore storage access errors
  }
  return next;
}
