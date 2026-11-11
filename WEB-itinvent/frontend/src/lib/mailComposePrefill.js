export const MAIL_COMPOSE_PREFILL_STORAGE_KEY = 'mail_compose_prefill_v1';
const PREFILL_TTL_MS = 5 * 60 * 1000;

const escapeHtml = (value) => (
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
);

export const plainTextToComposeHtml = (value) => {
  const lines = String(value || '').split(/\r?\n/);
  if (lines.length === 0) return '<p><br></p>';
  return lines.map((line) => `<p>${line ? escapeHtml(line) : '<br>'}</p>`).join('');
};

export const stashMailComposePrefill = ({
  to = [],
  subject = '',
  bodyPlain = '',
} = {}) => {
  if (typeof window === 'undefined') return;
  const payload = {
    to: Array.isArray(to) ? to.map((item) => String(item || '').trim()).filter(Boolean) : [],
    subject: String(subject || '').trim(),
    bodyPlain: String(bodyPlain || ''),
    createdAt: Date.now(),
  };
  window.sessionStorage.setItem(MAIL_COMPOSE_PREFILL_STORAGE_KEY, JSON.stringify(payload));
};

export const readMailComposePrefill = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(MAIL_COMPOSE_PREFILL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const createdAt = Number(parsed?.createdAt || 0);
    if (!createdAt || Date.now() - createdAt > PREFILL_TTL_MS) {
      window.sessionStorage.removeItem(MAIL_COMPOSE_PREFILL_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const clearMailComposePrefill = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(MAIL_COMPOSE_PREFILL_STORAGE_KEY);
};
