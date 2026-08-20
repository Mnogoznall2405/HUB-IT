import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailRecentListHydration from './useMailRecentListHydration';

const listPayload = { items: [{ id: 'msg-1' }], total: 1, has_more: false };

const createDeps = (overrides = {}) => ({
  mailCacheScope: 'mb-1',
  currentListContextKey: 'ctx-1',
  currentListCacheKey: ['mail', 'mb-1', 'list'],
  recentHydratedScope: 'mb-1',
  currentListKeyRef: { current: 'ctx-0' },
  listDataRef: { current: { items: [{ id: 'old' }] } },
  recentHydratedListContextsRef: { current: new Set() },
  setListData: vi.fn(),
  setFolderSummary: vi.fn(),
  setFolderTree: vi.fn(),
  setRecentHydratedScope: vi.fn(),
  setLoading: vi.fn(),
  staleTimeMs: 45000,
  getRecentHydration: vi.fn(() => null),
  peekListCache: vi.fn(() => null),
  writeListCache: vi.fn(),
  ...overrides,
});

describe('useMailRecentListHydration', () => {
  it('paints SWR cache when recent hydration is missing', () => {
    const deps = createDeps({
      peekListCache: vi.fn(() => ({ data: listPayload })),
    });

    renderHook(() => useMailRecentListHydration(deps));

    expect(deps.recentHydratedListContextsRef.current.has('ctx-1')).toBe(false);
    expect(deps.setRecentHydratedScope).toHaveBeenCalledWith('');
    expect(deps.setListData).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ id: 'msg-1' }],
      total: 1,
    }));
    expect(deps.currentListKeyRef.current).toBe('ctx-1');
    expect(deps.setLoading).not.toHaveBeenCalled();
    expect(deps.writeListCache).not.toHaveBeenCalled();
  });

  it('clears stale rows when context changed and no cache exists', () => {
    const deps = createDeps();

    renderHook(() => useMailRecentListHydration(deps));

    expect(deps.setListData).toHaveBeenCalledWith(expect.objectContaining({
      items: [],
      total: 0,
    }));
    expect(deps.setLoading).toHaveBeenCalledWith(true);
    expect(deps.currentListKeyRef.current).toBe('ctx-1');
    expect(deps.listDataRef.current).toEqual(expect.objectContaining({ items: [] }));
  });

  it('keeps the current rows when context is unchanged and there is no cache', () => {
    const deps = createDeps({
      currentListKeyRef: { current: 'ctx-1' },
    });

    renderHook(() => useMailRecentListHydration(deps));

    expect(deps.setListData).not.toHaveBeenCalled();
    expect(deps.setLoading).not.toHaveBeenCalled();
    expect(deps.currentListKeyRef.current).toBe('ctx-1');
  });

  it('applies recent hydration and writes the list into SWR', () => {
    const deps = createDeps({
      getRecentHydration: vi.fn(() => ({
        folderSummary: { inbox: { unread: 3 } },
        folderTree: [{ id: 'inbox' }],
        listData: listPayload,
      })),
    });

    renderHook(() => useMailRecentListHydration(deps));

    expect(deps.setFolderSummary).toHaveBeenCalledWith({ inbox: { unread: 3 } });
    expect(deps.setFolderTree).toHaveBeenCalledWith([{ id: 'inbox' }]);
    expect(deps.setListData).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ id: 'msg-1' }],
    }));
    expect(deps.writeListCache).toHaveBeenCalledWith(
      ['mail', 'mb-1', 'list'],
      expect.objectContaining({ items: [{ id: 'msg-1' }] }),
    );
    expect(deps.recentHydratedListContextsRef.current.has('ctx-1')).toBe(true);
    expect(deps.setRecentHydratedScope).toHaveBeenCalledWith('mb-1');
    expect(deps.setLoading).not.toHaveBeenCalled();
  });

  it('falls back to SWR when hydration has folders but no list payload', () => {
    const deps = createDeps({
      getRecentHydration: vi.fn(() => ({
        folderSummary: { inbox: { unread: 1 } },
        folderTree: [],
      })),
      peekListCache: vi.fn(() => ({ data: listPayload })),
    });

    renderHook(() => useMailRecentListHydration(deps));

    expect(deps.setFolderSummary).toHaveBeenCalledWith({ inbox: { unread: 1 } });
    expect(deps.setFolderTree).not.toHaveBeenCalled();
    expect(deps.setListData).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ id: 'msg-1' }],
    }));
    expect(deps.writeListCache).not.toHaveBeenCalled();
    expect(deps.recentHydratedListContextsRef.current.has('ctx-1')).toBe(false);
    expect(deps.setRecentHydratedScope).toHaveBeenCalledWith('mb-1');
  });
});
