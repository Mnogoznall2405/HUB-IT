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
    const set = (value) => { selected = value; };
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
      myFilesAPI: { listFiles: async () => ({ items: await api() }), getQuota: async () => ({}) },
      setLoading: noop, setRefreshing: noop, setItems: set, setQuota: noop, notifyApiError: noop,
      activeLoadsRef: { current: 0 },
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
