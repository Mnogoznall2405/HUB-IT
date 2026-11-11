import { classifyDeliveryFailure, parseRetryAfterMs, retryDelayMs, RETRY_AFTER_MAX_MS } from './nativeChatRetryPolicy';

const NOW = 1_787_500_000_000;
const httpError = (status: number, headers?: unknown, detail?: string) => Object.assign(
  new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, headers, data: detail ? { detail } : {} } });

describe('chat delivery failure classification (R-S4)', () => {
  it.each([
    ['503 is retried', httpError(503), { transient: true, reason: 'http_5xx' }],
    ['408 is retried', httpError(408), { transient: true, reason: 'http_408' }],
    ['429 is retried', httpError(429), { transient: true, reason: 'http_429' }],
    ['network loss is retried', Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }), { transient: true, reason: 'net' }],
    ['timeout is retried', Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }), { transient: true, reason: 'timeout' }],
    ['read-only offline is retried', Object.assign(new Error('offline'), { code: 'HUBIT_OFFLINE_READ_ONLY' }), { transient: true, reason: 'offline' }],
    ['413 parks the row', httpError(413), { transient: false, reason: 'http_4xx' }],
    ['403 parks the row', httpError(403), { transient: false, reason: 'http_4xx' }],
    ['a missing quoted message parks the row with its own reason',
      httpError(404, undefined, 'Quoted message not found'), { transient: false, reason: 'reply_missing' }],
    ['a local validation error parks the row', new Error('Некорректное подтверждение отправки'), { transient: false, reason: 'other' }],
  ])('%s', (_name, error, expected) => {
    expect(classifyDeliveryFailure(error, NOW)).toMatchObject(expected);
  });

  it('reads Retry-After from a Headers-like getter and from a plain object', () => {
    const getter = { get: (name: string) => (name === 'retry-after' ? '7' : null) };
    expect(classifyDeliveryFailure(httpError(429, getter), NOW).retryAfterMs).toBe(7_000);
    expect(classifyDeliveryFailure(httpError(429, { 'Retry-After': '3' }), NOW).retryAfterMs).toBe(3_000);
  });
});

describe('Retry-After and backoff arithmetic', () => {
  it('accepts delta-seconds and HTTP-dates, rejects garbage, and clamps to the maximum', () => {
    expect(parseRetryAfterMs('12', NOW)).toBe(12_000);
    expect(parseRetryAfterMs(new Date(NOW + 9_000).toUTCString(), NOW)).toBe(9_000);
    expect(parseRetryAfterMs('soon', NOW)).toBeNull();
    expect(parseRetryAfterMs('', NOW)).toBeNull();
    expect(parseRetryAfterMs('99999999999999999999999', NOW)).toBe(RETRY_AFTER_MAX_MS);
  });

  it('applies the ladder with ±20 % jitter and never grows past the cap', () => {
    const midpoint = () => 0.5;
    expect(retryDelayMs(1, midpoint)).toBe(2_000);
    expect(retryDelayMs(3, midpoint)).toBe(15_000);
    expect(retryDelayMs(1, () => 0)).toBe(1_600);
    expect(retryDelayMs(1, () => 1)).toBe(2_400);
    expect(retryDelayMs(9, () => 1)).toBe(36_000);
    expect(retryDelayMs(Number.NaN, midpoint)).toBe(2_000);
  });

  it('uses Retry-After as a floor and ignores a non-finite hint', () => {
    expect(retryDelayMs(1, () => 0.5, 120_000)).toBe(120_000);
    expect(retryDelayMs(4, () => 0.5, 1_000)).toBe(30_000);
    expect(retryDelayMs(1, () => 0.5, Number.NaN)).toBe(2_000);
  });
});
