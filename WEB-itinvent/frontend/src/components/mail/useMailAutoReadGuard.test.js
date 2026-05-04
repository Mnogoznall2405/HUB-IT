import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMailAutoReadGuard from './useMailAutoReadGuard';

describe('useMailAutoReadGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks duplicate auto-read work while a key is in flight', () => {
    const { result } = renderHook(() => useMailAutoReadGuard({ ttlMs: 120000 }));

    act(() => {
      expect(result.current.begin('message-1:auto-read')).toBe(true);
      expect(result.current.begin('message-1:auto-read')).toBe(false);
      expect(result.current.begin('message-2:auto-read')).toBe(true);
    });
  });

  it('keeps a successful guard key blocked until ttl expires', () => {
    const { result } = renderHook(() => useMailAutoReadGuard({ ttlMs: 120000 }));

    act(() => {
      expect(result.current.begin('message-1:auto-read')).toBe(true);
      result.current.settle('message-1:auto-read', true);
      expect(result.current.begin('message-1:auto-read')).toBe(false);
    });

    act(() => {
      vi.advanceTimersByTime(120000);
      expect(result.current.begin('message-1:auto-read')).toBe(true);
    });
  });

  it('allows immediate retry when the guarded mutation fails', () => {
    const { result } = renderHook(() => useMailAutoReadGuard({ ttlMs: 120000 }));

    act(() => {
      expect(result.current.begin('message-1:auto-read')).toBe(true);
      result.current.settle('message-1:auto-read', false);
      expect(result.current.begin('message-1:auto-read')).toBe(true);
    });
  });

  it('ignores empty guard keys', () => {
    const { result } = renderHook(() => useMailAutoReadGuard({ ttlMs: 120000 }));

    act(() => {
      expect(result.current.begin('')).toBe(false);
      expect(result.current.begin('   ')).toBe(false);
      result.current.settle('', true);
    });
  });
});
