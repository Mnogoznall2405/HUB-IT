import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useRequestGuard from './lib/useRequestGuard';

// Execute the actual loader body with controlled API timing. UI wiring is
// covered separately by the page/component tests; these are isolated loaders.
function bindLoader(file, name, context) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let callback;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name === name) callback = node.init.arguments[0];
    Object.values(node).forEach((value) => Array.isArray(value) ? value.forEach(visit) : visit(value));
  }
  visit(ast);
  if (!callback) throw new Error(`Missing loader ${name}`);
  return new Function(...Object.keys(context), `return (${source.slice(callback.start, callback.end)})`)(...Object.values(context));
}

describe('request ordering in page loaders', () => {
  it.each(['balances', 'movements', 'users', 'sessions', 'files'])('%s ignores an older response after a newer refresh', async (kind) => {
    const { result } = renderHook(() => useRequestGuard());
    const pending = [];
    const api = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
    let selected;
    // setters may receive an updater function (MyFiles reconciles by id)
    const set = (value) => { selected = typeof value === 'function' ? value([]) : value; };
    const noop = () => {};
    const context = {
      beginBalances: result.current, beginMovements: result.current, beginUsers: result.current,
      beginSessions: result.current, beginLoad: result.current,
      canSearchBalances: true, balNomenclatureValue: { ref: 'n' }, balWarehouseValue: null, balTextQuery: '',
      movNomenclatureValue: { ref: 'n' }, movWarehouseValue: null, movSeriesFilter: null, dateFrom: '', dateTo: '',
      setBalancesLoading: noop, setBalancesError: noop, setBalancesSearched: noop, setBalancesMeta: noop, setBalances: set,
      setMovementsLoading: noop, setMovementsError: noop, setMovementsSearched: noop, setMovementsMeta: noop, setMovements: set,
      normalizeWarehouse1cListResponse: (value) => ({ items: value, meta: {} }), sortBalancesByNomenclature: (value) => value,
      warehouse1cAPI: { getBalances: api, getMovements: api },
      canManageUsers: true, canManageSessions: true,
      authAPI: { getUsers: api, getSessions: api, getTaskDelegatesBulk: async () => ({ items: [] }) },
      setUsersLoading: noop, setUsers: set, setBlockingError: noop, setSessionsLoading: noop, setSessions: set,
      normalizePermissions: (value) => value, mergeTaskDelegatesIntoUsers: (value) => value,
      myFilesAPI: { listFiles: async () => ({ items: await api() }), getQuota: async () => ({}), listFolders: async () => ({ items: [] }) },
      setLoading: noop, setRefreshing: noop, setItems: set, setQuota: noop, notifyApiError: noop,
      setFolders: noop, setBreadcrumbs: noop, setAllFolders: noop,
      reconcileById: (_previous, next) => next,
      libraryId: null, myFilesLibrariesAPI: { list: async () => null },
      setLibraries: noop, setCanManageLibraries: noop, setLibraryInfo: noop,
      isTrashView: false, listView: 'all', currentFolderId: null, debouncedSearchQuery: '',
      isSharedView: false,
      activeLoadsRef: { current: 0 },
      latestIsCurrentRef: { current: null }, loadAbortRef: { current: null },
      listingsCacheRef: { current: new Map() },
      LISTINGS_CACHE_TTL_MS: 20_000, LISTINGS_CACHE_MAX: 30, authUserKey: 'u7',
      applyListingsPayload: ({ filesPayload }) => { if (filesPayload) set(filesPayload.items || []); },
    };
    const file = ['users', 'sessions'].includes(kind) ? './pages/account/hooks/useAccountSectionData.js'
      : kind === 'files' ? './pages/MyFiles.jsx' : './pages/Warehouse1C.jsx';
    const name = { balances: 'handleSearchBalances', movements: 'runMovementsSearch', users: 'loadUsers', sessions: 'loadSessions', files: 'loadData' }[kind];
    const loader = bindLoader(file, name, context);
    const older = loader();
    const newer = loader();
    pending[1]([{ id: 'new' }]);
    await newer;
    pending[0]([{ id: 'old' }]);
    await older;
    expect(selected.map((item) => item.id)).toEqual(['new']);
  });
});

// MyFiles-specific loadData internals: the SWR cache, the active-load counter
// and the access-denied cleanup. Executing the real callback keeps these tied
// to the shipped implementation, not a re-implementation.
function bindMyFilesLoader(overrides = {}) {
  const context = {
    beginLoad: overrides.beginLoad,
    latestIsCurrentRef: { current: null },
    loadAbortRef: { current: null },
    activeLoadsRef: { current: 0 },
    listingsCacheRef: { current: new Map() },
    LISTINGS_CACHE_TTL_MS: 20_000, LISTINGS_CACHE_MAX: 30,
    authUserKey: 'u7',
    isTrashView: false, isSharedView: false, listView: 'all', libraryId: null,
    currentFolderId: null, debouncedSearchQuery: '',
    myFilesAPI: {
      listFiles: overrides.listFiles || (async () => ({ items: [] })),
      getQuota: async () => ({}),
      listFolders: async () => ({ items: [] }),
    },
    applyListingsPayload: overrides.applyListingsPayload || (() => {}),
    setLoading: () => {}, setRefreshing: () => {},
    notifyApiError: overrides.notifyApiError || (() => {}),
    ...overrides.extra,
  };
  const loader = bindLoader('./pages/MyFiles.jsx', 'loadData', context);
  return { loader, context };
}

describe('my-files loadData counter and cache', () => {
  it('decrements the active-loads counter when superseded during a cache-hit revalidation', async () => {
    const { result } = renderHook(() => useRequestGuard());
    const rafQueue = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    try {
      const pending = [];
      const { loader, context } = bindMyFilesLoader({
        beginLoad: result.current,
        listFiles: () => new Promise((resolve) => pending.push(resolve)),
      });
      // First load populates the cache.
      const first = loader();
      pending[0]({ items: [{ id: 'f1' }] });
      await first;
      expect(context.activeLoadsRef.current).toBe(0);

      // Cache-hit revalidation is superseded by a fresh navigation while it
      // waits for the paint frame — the old body bailed via `return` BEFORE
      // the try/finally, leaking +1 forever.
      const stale = loader();
      const newest = loader();
      while (rafQueue.length) rafQueue.splice(0).forEach((cb) => cb());
      // Let the post-rAF continuations reach the fetch call.
      await Promise.resolve();
      pending[1]({ items: [{ id: 'f2' }] });
      await Promise.all([stale, newest]);
      expect(context.activeLoadsRef.current).toBe(0);
    } finally {
      rafSpy.mockRestore();
    }
  });

  it('clears screen data and evicts the cache entry on 403', async () => {
    const { result } = renderHook(() => useRequestGuard());
    const payloads = [];
    const { loader, context } = bindMyFilesLoader({
      beginLoad: result.current,
      listFiles: async () => { const e = new Error('denied'); e.response = { status: 403 }; throw e; },
      applyListingsPayload: (p) => payloads.push(p),
    });
    context.listingsCacheRef.current.set('u7|all|||', { t: Date.now(), payload: { filesPayload: { items: [{ id: 'stale' }] } } });
    await loader();
    expect(payloads.at(-1).filesPayload.items).toEqual([]);
    expect(context.listingsCacheRef.current.has('u7|all|||')).toBe(false);
    expect(context.activeLoadsRef.current).toBe(0);
  });

  it('binds cache entries to the auth identity', async () => {
    const { result } = renderHook(() => useRequestGuard());
    const shared = { current: new Map() };
    const calls = [];
    const makeLoader = (authUserKey) => {
      const { loader } = bindMyFilesLoader({
        beginLoad: result.current,
        authUserKey,
        listFiles: async () => { calls.push(authUserKey); return { items: [] }; },
        extra: { listingsCacheRef: shared },
      });
      return loader;
    };
    await makeLoader('u7')();
    expect(calls).toEqual(['u7']);
    // Same view, same cache map, different identity — must NOT reuse u7's entry.
    await makeLoader('u9')();
    expect(calls).toEqual(['u7', 'u9']);
  });

  it('never paints a cached payload in a shared scope before server validation', async () => {
    const { result } = renderHook(() => useRequestGuard());
    const applied = [];
    const sharedCache = { current: new Map([
      ['u7|all|lib-1||', { t: Date.now(), payload: { filesPayload: { items: [{ id: 'cached-secret' }] } } }],
    ]) };
    let release;
    const { loader } = bindMyFilesLoader({
      beginLoad: result.current,
      applyListingsPayload: (p) => applied.push(p),
      listFiles: () => new Promise((resolve) => { release = resolve; }),
      extra: { listingsCacheRef: sharedCache, libraryId: 'lib-1' },
    });
    const pending = loader();
    await Promise.resolve();
    // A stale cached payload exists for this exact key — it must NOT be applied.
    expect(applied).toEqual([]);
    release({ items: [] });
    await pending;
    expect(applied).toHaveLength(1);
    expect(applied[0].filesPayload.items).toEqual([]);
  });

  it('never paints a cached payload in the trash view before server validation', async () => {
    const { result } = renderHook(() => useRequestGuard());
    const applied = [];
    const sharedCache = { current: new Map([
      ['u7|trash|||', { t: Date.now(), payload: { filesPayload: { items: [{ id: 'cached-deleted' }] } } }],
    ]) };
    let release;
    const { loader } = bindMyFilesLoader({
      beginLoad: result.current,
      applyListingsPayload: (p) => applied.push(p),
      listFiles: () => new Promise((resolve) => { release = resolve; }),
      extra: { listingsCacheRef: sharedCache, isTrashView: true },
    });
    const pending = loader();
    await Promise.resolve();
    expect(applied).toEqual([]);
    release({ items: [] });
    await pending;
    expect(applied).toHaveLength(1);
    expect(applied[0].filesPayload.items).toEqual([]);
  });
});

describe('my-files loadLibraries identity guard', () => {
  it('discards a response that started under the previous auth identity', async () => {
    const authUserKeyRef = { current: 'u7' };
    const applied = [];
    const release = [];
    const list = () => new Promise((resolve) => release.push(resolve));
    const make = (authUserKey) => bindLoader('./pages/MyFiles.jsx', 'loadLibraries', {
      authUserKey,
      authUserKeyRef,
      myFilesLibrariesAPI: { list },
      setLibraries: (v) => applied.push(v),
      setCanManageLibraries: () => {},
    });
    const callA = make('u7')();
    authUserKeyRef.current = 'u9'; // identity switched while A was in flight
    const callB = make('u9')();
    release[0]({ items: [{ id: 'lib-A' }] });
    await callA;
    release[1]({ items: [{ id: 'lib-B' }] });
    await callB;
    expect(applied).toEqual([[{ id: 'lib-B' }]]);
  });
});

// A mutation succeeds but only patches local state: every OTHER cached
// listing (other folders/views holding the same entry) is now stale and must
// be dropped. These run the real handler bodies against a seeded cache map.
describe('my-files mutation cache invalidation', () => {
  const seededCache = () => ({ current: new Map([['u7|all|||', { t: Date.now(), payload: {} }]]) });

  it('handleToggleFavorite clears the cache after a successful update', async () => {
    const listingsCacheRef = seededCache();
    const handler = bindLoader('./pages/MyFiles.jsx', 'handleToggleFavorite', {
      setItems: () => {}, setFolders: () => {}, isFavoritesView: false,
      myFilesAPI: { updateFile: async () => ({}), updateFolder: async () => ({}) },
      listingsCacheRef, loadData: async () => {}, notifyApiError: () => {},
    });
    await handler({ id: 'f1', is_favorite: false }, 'file');
    expect(listingsCacheRef.current.size).toBe(0);
  });

  it('handleMoveFileToFolder clears the cache after a successful move', async () => {
    const listingsCacheRef = seededCache();
    const handler = bindLoader('./pages/MyFiles.jsx', 'handleMoveFileToFolder', {
      myFilesAPI: { updateFile: async () => ({}) }, listingsCacheRef,
      isSpecialView: false, currentFolderId: null,
      setItems: () => {}, notifySuccess: () => {}, notifyApiError: () => {},
    });
    await handler('f1', 'folder-9');
    expect(listingsCacheRef.current.size).toBe(0);
  });

  it('handleMoveFolderToFolder clears the cache after a successful move', async () => {
    const listingsCacheRef = seededCache();
    const handler = bindLoader('./pages/MyFiles.jsx', 'handleMoveFolderToFolder', {
      myFilesAPI: { updateFolder: async () => ({}) }, listingsCacheRef,
      currentFolderId: null,
      setAllFolders: () => {}, setFolders: () => {},
      notifySuccess: () => {}, notifyApiError: () => {},
    });
    await handler('d1', 'd2');
    expect(listingsCacheRef.current.size).toBe(0);
  });
});
