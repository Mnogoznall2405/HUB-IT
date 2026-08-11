import { describe, expect, it, vi } from 'vitest';

import {
  isChatReadConcurrencyFullError,
  resolveChatReadRetryAfterMs,
} from './chatThreadTransport';

describe('chatThreadTransport read backoff', () => {
  it('detects chat read concurrency full 503', () => {
    expect(isChatReadConcurrencyFullError({
      response: {
        status: 503,
        data: { detail: 'chat read concurrency full (limit=8, acquire_timeout_ms=50)' },
      },
    })).toBe(true);
  });

  it('ignores unrelated 503', () => {
    expect(isChatReadConcurrencyFullError({
      response: { status: 503, data: { detail: 'upstream down' } },
    })).toBe(false);
  });

  it('respects Retry-After with minimum floor and jitter bound', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ms = resolveChatReadRetryAfterMs({
      response: { headers: { 'retry-after': '2' } },
    });
    expect(ms).toBe(2000);
    Math.random.mockRestore();
  });

  it('never returns aggressive zero retry', () => {
    const ms = resolveChatReadRetryAfterMs({
      response: { headers: { 'retry-after': '0' } },
    }, { fallbackMs: 1000 });
    expect(ms).toBeGreaterThanOrEqual(250);
  });
});
