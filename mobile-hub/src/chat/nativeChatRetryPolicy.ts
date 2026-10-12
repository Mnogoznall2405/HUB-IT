// Pure retry policy for chat delivery (R-S4). No storage and no timers: the
// outbox classifies the thrown transport error and asks for the next delay.
// Transient failures (network, timeout, 408, 429, 5xx, offline) are retried
// without an attempt cap; everything else is a permanent failure that parks
// the row as paused.

/** Base delays before jitter; the last step is the cap (~30 s). */
export const RETRY_LADDER_MS = [2_000, 5_000, 15_000, 30_000] as const;
/** Symmetric jitter around the ladder step: ±20 %. */
export const RETRY_JITTER_RATIO = 0.2;
/** Upper bound for a server Retry-After hint, so a bad header cannot park a message for hours. */
export const RETRY_AFTER_MAX_MS = 5 * 60_000;

/** Why a transient backoff is cut short: the app came back, the network came back, the socket reconnected or the user acted. */
export type NativeChatWakeReason = 'foreground' | 'network' | 'socket' | 'manual';

export type DeliveryFailure = {
  transient: boolean;
  /** Short enum-like token (safe for the device log): net, timeout, offline, http_408, http_429, http_5xx, http_4xx, reply_missing, other. */
  reason: string;
  /** Server Retry-After hint in ms, clamped; null when absent. */
  retryAfterMs: number | null;
};

type ErrorLike = {
  code?: string;
  isAxiosError?: boolean;
  response?: { status?: number; headers?: unknown; data?: { detail?: unknown } };
};

function readHeader(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    try { return getter.call(headers, name); } catch { return undefined; }
  }
  const plain = headers as Record<string, unknown>;
  return plain[name] ?? plain['Retry-After'];
}

/**
 * Retry-After as delta-seconds or an HTTP-date. Returns null for anything that
 * is not a finite time; the result is clamped to [0, RETRY_AFTER_MAX_MS].
 */
export function parseRetryAfterMs(value: unknown, now: number): number | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  let ms: number;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else {
    const at = Date.parse(text);
    if (!Number.isFinite(at)) return null;
    ms = at - now;
  }
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(0, Math.round(ms)), RETRY_AFTER_MAX_MS);
}

export function classifyDeliveryFailure(error: unknown, now = Date.now()): DeliveryFailure {
  const e = (error ?? null) as ErrorLike | null;
  if (e?.code === 'HUBIT_OFFLINE_READ_ONLY') return { transient: true, reason: 'offline', retryAfterMs: null };
  const response = e?.response;
  if (response) {
    const status = Number(response.status) || 0;
    const retryAfterMs = parseRetryAfterMs(readHeader(response.headers, 'retry-after'), now);
    if (status === 408 || status === 429) return { transient: true, reason: `http_${status}`, retryAfterMs };
    if (status >= 500 && status <= 599) return { transient: true, reason: 'http_5xx', retryAfterMs };
    if (status === 404 && response.data?.detail === 'Quoted message not found') {
      return { transient: false, reason: 'reply_missing', retryAfterMs: null };
    }
    return { transient: false, reason: status ? 'http_4xx' : 'other', retryAfterMs: null };
  }
  if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') return { transient: true, reason: 'timeout', retryAfterMs: null };
  if (e?.isAxiosError === true || e?.code === 'ERR_NETWORK') return { transient: true, reason: 'net', retryAfterMs: null };
  return { transient: false, reason: 'other', retryAfterMs: null };
}

function unitRandom(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(Math.max(value, 0), 0.999_999);
}

/**
 * Delay before the next automatic attempt. `attempt` is the number of attempts
 * already made (1 after the first failure). The ladder index is clamped, so
 * any attempt count keeps the delay at the cap. A Retry-After hint acts as a
 * floor. `random` is injectable so the jitter is deterministic in tests.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random, retryAfterMs: number | null = null): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.floor(attempt) : 1;
  const index = Math.min(Math.max(safeAttempt - 1, 0), RETRY_LADDER_MS.length - 1);
  const factor = 1 + RETRY_JITTER_RATIO * (2 * unitRandom(random()) - 1);
  const jittered = Math.round(RETRY_LADDER_MS[index] * factor);
  const floor = retryAfterMs !== null && Number.isFinite(retryAfterMs)
    ? Math.min(Math.max(retryAfterMs, 0), RETRY_AFTER_MAX_MS)
    : 0;
  return Math.max(jittered, floor);
}
