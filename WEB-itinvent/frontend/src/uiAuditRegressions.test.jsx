import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { useState, useEffect, useCallback } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useRequestGuard from './lib/useRequestGuard';
import { ticketsAPI } from './api/tickets';
import TicketRequestCard from './components/tickets/TicketRequestCard';

vi.mock('./api/tickets', () => ({ ticketsAPI: { getRequest: vi.fn(), updateRequest: vi.fn() } }));
const noop = () => {};
function extract(file, name, effect = false) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  let found;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (!effect && node.type === 'VariableDeclarator' && node.id?.name === name) found = node.init.type === 'CallExpression' ? node.init.arguments[0] : node.init;
    if (effect && node.type === 'CallExpression' && node.callee?.name === 'useEffect' && source.slice(node.start, node.end).includes('const needsDatabases')) found = node.arguments[0];
    Object.values(node).forEach((v) => Array.isArray(v) ? v.forEach(visit) : visit(v));
  };
  visit(parse(source, { sourceType: 'module', plugins: ['jsx'] }));
  return source.slice(found.start, found.end);
}
const bind = (source, context) => new Function(...Object.keys(context), `return (${source})`)(...Object.values(context));
const defer = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };

it('keeps request B after the save for request A completes', async () => {
  const save = defer();
  ticketsAPI.updateRequest.mockReturnValue(save.promise);
  ticketsAPI.getRequest.mockImplementation(async (id) => ({ id, status: 'new', employee_name: `employee-${id}` }));
  const { rerender } = render(<TicketRequestCard requestId={1} canWrite />);
  await screen.findByText('Заявка #1');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(ticketsAPI.updateRequest).toHaveBeenCalledTimes(1));
  rerender(<TicketRequestCard requestId={null} canWrite />);
  rerender(<TicketRequestCard requestId={2} canWrite />);
  await screen.findByText('Заявка #2');
  await act(async () => save.resolve({}));
  expect(screen.getByText('Заявка #2')).toBeInTheDocument();
});

it('keeps the latest employee selection', async () => {
  const { result } = renderHook(() => useRequestGuard());
  const a = defer(), b = defer();
  let selected;
  const open = bind(extract('./components/tickets/TicketEmployeeCard.jsx', 'openEmployee'), {
    beginEmployee: result.current, setError: noop, setSuccess: noop, setZupSelected: noop, setZupSearch: noop,
    ticketsAPI: { getEmployee: (id) => id === 'A' ? a.promise : b.promise }, applyEmployee: (value) => { selected = value; },
  });
  const first = open('A'), second = open('B');
  b.resolve({ id: 'B' }); await second;
  a.resolve({ id: 'A' }); await first;
  expect(selected.id).toBe('B');
});

it('keeps the selected movement detail', async () => {
  const { result } = renderHook(() => useRequestGuard());
  const a = defer(), b = defer();
  let row, detail;
  const open = bind(extract('./pages/Warehouse1C.jsx', 'handleOpenMovementDetail'), {
    beginMovementDetail: result.current, canOpenMovementDetail: () => true, setMovementDetailRow: (value) => { row = value; },
    setMovementDetailData: (value) => { detail = value; }, setMovementDetailError: noop,
    setDownloadingFileRef: noop, setPreviewingFileRef: noop, setMovementDetailLoading: noop, setMovementDetailOpen: noop,
    warehouse1cAPI: { getMovementDetail: (id) => id === 'A' ? a.promise : b.promise },
  });
  open({ registrar_ref: 'A' }); open({ registrar_ref: 'B' });
  await act(async () => b.resolve({ id: 'B' }));
  await act(async () => a.resolve({ id: 'A' }));
  expect([row.registrar_ref, detail.id]).toEqual(['B', 'B']);
});

it('stops automatic database requests after failure and supports manual retry', async () => {
  const requests = [];
  const file = './pages/account/hooks/useAccountSectionData.js';
  const loaderSource = extract(file, 'loadDatabases');
  const effectSource = extract(file, '', true);
  const api = { getAvailableDatabases: () => { const d = defer(); requests.push(d); return d.promise; } };
  const { result, unmount } = renderHook(() => {
    const [databasesAttempted, setDatabasesAttempted] = useState(false);
    const [databasesLoaded, setDatabasesLoaded] = useState(false);
    const [databasesLoading, setDatabasesLoading] = useState(false);
    const loadDatabases = useCallback(bind(loaderSource, { databaseAPI: api, setDatabasesAttempted, setDatabasesError: noop, setDatabasesLoaded, setDatabasesLoading, setDatabases: noop, setBlockingError: noop, console: { error: noop } }), []);
    useEffect(bind(effectSource, { tab: 'profile', user: { id: 1 }, canManageUsers: false, canManageAiBots: false, databasesAttempted, databasesLoaded, databasesLoading, loadDatabases }), [databasesAttempted, databasesLoaded, databasesLoading, loadDatabases]);
    return { loadDatabases };
  });
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => requests[0].reject(new Error('synthetic API failure')));
  expect(requests).toHaveLength(1);
  act(() => { void result.current.loadDatabases(); });
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].resolve([]));
  expect(requests).toHaveLength(2);
  unmount();
});

it('reports a rejected ticket export', async () => {
  const setError = vi.fn();
  const exportRows = bind(extract('./components/tickets/TicketRequestList.jsx', 'exportRows'), {
    beginExport: () => () => true, exportingRef: { current: false }, setExporting: noop, getErrorMessage: (e) => e.message, params: {}, ticketsAPI: { exportRequests: async () => { throw new Error('synthetic export failure'); } },
    downloadBlob: noop, setError,
  });
  await expect(exportRows()).resolves.toBeUndefined();
  expect(setError).toHaveBeenCalledWith('synthetic export failure');
});

it('downloads a successful export once and prevents overlapping exports', async () => {
  const pending = defer();
  const downloadBlob = vi.fn(), setExporting = vi.fn();
  const exportRequests = vi.fn(() => pending.promise);
  const exportRows = bind(extract('./components/tickets/TicketRequestList.jsx', 'exportRows'), {
    beginExport: () => () => true, exportingRef: { current: false }, setExporting, setError: noop,
    params: {}, ticketsAPI: { exportRequests }, downloadBlob,
  });
  const first = exportRows();
  await exportRows();
  expect(exportRequests).toHaveBeenCalledTimes(1);
  const blob = new Blob(['synthetic spreadsheet']);
  pending.resolve(blob);
  await first;
  expect(downloadBlob).toHaveBeenCalledWith(blob, 'ticket-requests.xlsx');
  expect(setExporting).toHaveBeenLastCalledWith(false);
});

it('ignores employee data after its dialog scope closes', async () => {
  const { result, rerender } = renderHook(({ open }) => useRequestGuard(open), { initialProps: { open: true } });
  const pending = defer(), applyEmployee = vi.fn();
  const openEmployee = bind(extract('./components/tickets/TicketEmployeeCard.jsx', 'openEmployee'), {
    beginEmployee: result.current, setError: noop, setSuccess: noop, setZupSelected: noop, setZupSearch: noop,
    ticketsAPI: { getEmployee: () => pending.promise }, applyEmployee,
  });
  const request = openEmployee('A');
  rerender({ open: false });
  pending.resolve({ id: 'A' });
  await request;
  expect(applyEmployee).not.toHaveBeenCalled();
});

it('ignores movement detail after closing the dialog', async () => {
  const { result } = renderHook(() => useRequestGuard());
  const pending = defer(), setMovementDetailData = vi.fn();
  const context = {
    beginMovementDetail: result.current, canOpenMovementDetail: () => true, setMovementDetailRow: noop,
    setMovementDetailData, setMovementDetailError: noop, setDownloadingFileRef: noop, setPreviewingFileRef: noop,
    setMovementDetailLoading: noop, setMovementDetailOpen: noop,
    warehouse1cAPI: { getMovementDetail: () => pending.promise },
  };
  bind(extract('./pages/Warehouse1C.jsx', 'handleOpenMovementDetail'), context)({ registrar_ref: 'A' });
  bind(extract('./pages/Warehouse1C.jsx', 'handleCloseMovementDetail'), context)();
  setMovementDetailData.mockClear();
  await act(async () => pending.resolve({ id: 'A' }));
  expect(setMovementDetailData).not.toHaveBeenCalled();
});
