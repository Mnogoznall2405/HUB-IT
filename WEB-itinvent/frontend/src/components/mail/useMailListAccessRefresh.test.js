import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailListAccessRefresh from './useMailListAccessRefresh';

const createDeps = (overrides = {}) => ({
  mailAccessReady: true,
  currentListContextKey: 'ctx-1',
  lastListRefreshContextKeyRef: { current: '' },
  skipNextListRefreshRef: { current: false },
  refreshList: vi.fn(),
  ...overrides,
});

describe('useMailListAccessRefresh', () => {
  it('does nothing until mail access is ready', () => {
    const deps = createDeps({ mailAccessReady: false });
    renderHook(() => useMailListAccessRefresh(deps));
    expect(deps.refreshList).not.toHaveBeenCalled();
  });

  it('pulls the first context without forcing the network', () => {
    const deps = createDeps();
    renderHook(() => useMailListAccessRefresh(deps));
    expect(deps.lastListRefreshContextKeyRef.current).toBe('ctx-1');
    expect(deps.refreshList).toHaveBeenCalledWith(expect.objectContaining({
      force: false,
      reason: 'access-ready',
    }));
  });

  it('skips a duplicate pull for the already-painted context', () => {
    const deps = createDeps({
      lastListRefreshContextKeyRef: { current: 'ctx-1' },
      skipNextListRefreshRef: { current: true },
    });
    renderHook(() => useMailListAccessRefresh(deps));
    expect(deps.skipNextListRefreshRef.current).toBe(false);
    expect(deps.refreshList).not.toHaveBeenCalled();
    expect(deps.lastListRefreshContextKeyRef.current).toBe('ctx-1');
  });

  it('still fetches when skip is set but the list context changed', () => {
    const deps = createDeps({
      currentListContextKey: 'ctx-2',
      lastListRefreshContextKeyRef: { current: 'ctx-1' },
      skipNextListRefreshRef: { current: true },
    });
    renderHook(() => useMailListAccessRefresh(deps));
    expect(deps.skipNextListRefreshRef.current).toBe(false);
    expect(deps.refreshList).toHaveBeenCalledWith(expect.objectContaining({
      force: true,
      reason: 'context-effect',
    }));
  });

  it('does not refetch the same context after the first pull', () => {
    const deps = createDeps({
      lastListRefreshContextKeyRef: { current: 'ctx-1' },
    });
    renderHook(() => useMailListAccessRefresh(deps));
    expect(deps.refreshList).not.toHaveBeenCalled();
  });
});
