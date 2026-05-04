import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMailAsyncTaskGate from './useMailAsyncTaskGate';

describe('useMailAsyncTaskGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates concurrent work for the same gate key', async () => {
    const { result } = renderHook(() => useMailAsyncTaskGate({ cooldownMs: 4000 }));
    let resolveTask;
    const task = vi.fn(() => new Promise((resolve) => {
      resolveTask = resolve;
    }));

    let first;
    let second;
    act(() => {
      first = result.current.run('mail-view:inbox', task);
      second = result.current.run('mail-view:inbox', task);
    });

    expect(first).toBe(second);
    expect(task).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveTask('done');
      await first;
    });
  });

  it('blocks repeated work until cooldown expires', async () => {
    const { result } = renderHook(() => useMailAsyncTaskGate({ cooldownMs: 4000 }));
    const task = vi.fn(() => Promise.resolve('done'));

    let first;
    await act(async () => {
      first = result.current.run('mail-view:inbox', task);
      await first;
    });

    act(() => {
      expect(result.current.run('mail-view:inbox', task)).toBeNull();
    });

    await act(async () => {
      vi.advanceTimersByTime(4000);
      await result.current.run('mail-view:inbox', task);
    });

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('allows force and bypassCooldown to ignore a recent completion', async () => {
    const { result } = renderHook(() => useMailAsyncTaskGate({ cooldownMs: 4000 }));
    const task = vi.fn(() => Promise.resolve('done'));

    await act(async () => {
      await result.current.run('mail-view:inbox', task);
      await result.current.run('mail-view:inbox', task, { force: true });
      await result.current.run('mail-view:inbox', task, { bypassCooldown: true });
    });

    expect(task).toHaveBeenCalledTimes(3);
  });

  it('clears a completed key manually', async () => {
    const { result } = renderHook(() => useMailAsyncTaskGate({ cooldownMs: 4000 }));
    const task = vi.fn(() => Promise.resolve('done'));

    await act(async () => {
      await result.current.run('mail-view:inbox', task);
    });

    act(() => {
      result.current.clear('mail-view:inbox');
    });

    await act(async () => {
      await result.current.run('mail-view:inbox', task);
    });

    expect(task).toHaveBeenCalledTimes(2);
  });
});
