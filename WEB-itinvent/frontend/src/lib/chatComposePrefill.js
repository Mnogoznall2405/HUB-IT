export const CHAT_COMPOSE_PREFILL_STORAGE_KEY = 'chat_compose_prefill_v1';
const PREFILL_TTL_MS = 5 * 60 * 1000;

export const isChatComposePrefillRoute = (search = '') => (
  new URLSearchParams(String(search || '')).get('compose') === 'prefill'
);

export const stashChatComposePrefill = ({
  peerUserId = 0,
  bodyText = '',
} = {}) => {
  if (typeof window === 'undefined') return;
  const payload = {
    peerUserId: Number(peerUserId || 0),
    bodyText: String(bodyText || ''),
    createdAt: Date.now(),
  };
  window.sessionStorage.setItem(CHAT_COMPOSE_PREFILL_STORAGE_KEY, JSON.stringify(payload));
};

export const readChatComposePrefill = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CHAT_COMPOSE_PREFILL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const createdAt = Number(parsed?.createdAt || 0);
    if (!createdAt || Date.now() - createdAt > PREFILL_TTL_MS) {
      window.sessionStorage.removeItem(CHAT_COMPOSE_PREFILL_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const clearChatComposePrefill = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(CHAT_COMPOSE_PREFILL_STORAGE_KEY);
};
