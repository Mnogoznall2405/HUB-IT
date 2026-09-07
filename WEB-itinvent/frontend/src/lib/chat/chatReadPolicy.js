export const CHAT_SWR_STALE_TIME_MS = 30_000;

export const isChatReadConcurrencyFullError = (error) => {
  const status = Number(error?.response?.status || 0);
  if (status !== 503 && status !== 429) return false;
  const detail = String(error?.response?.data?.detail || error?.message || '').toLowerCase();
  return detail.includes('chat read concurrency full') || status === 429;
};

/** Parse Retry-After (seconds) with jitter; never returns aggressive 0ms retry. */
export const resolveChatReadRetryAfterMs = (error, {
  attempt = 0,
  fallbackMs = 1000,
  maxMs = 15000,
  jitterRatio = 0.25,
} = {}) => {
  const headers = error?.response?.headers || {};
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  let baseMs = Number(fallbackMs) || 1000;
  if (raw != null && String(raw).trim() !== '') {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      baseMs = Math.max(250, asNumber * 1000);
    }
  } else {
    baseMs = Math.min(Number(maxMs) || 15000, baseMs * (2 ** Math.max(0, Number(attempt) || 0)));
  }
  const jitter = Math.max(0, Math.min(1, Number(jitterRatio) || 0)) * baseMs;
  const withJitter = baseMs + (Math.random() * jitter);
  return Math.max(250, Math.min(Number(maxMs) || 15000, Math.round(withJitter)));
};

