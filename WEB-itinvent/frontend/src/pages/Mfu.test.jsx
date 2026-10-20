import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Mfu from './Mfu';
import { mfuAPI } from '../api/client';
import { buildCacheKey, clearSWRCache, peekSWRCache } from '../lib/swrCache';

vi.mock('../api/client', () => ({ mfuAPI: { getDevices: vi.fn() }, equipmentAPI: {} }));
vi.mock('../api/json_client', () => ({ default: {} }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7 }, hasPermission: () => false }) }));
vi.mock('../components/layout/MainLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../components/layout/PageShell', () => ({ default: ({ children }) => <div>{children}</div> }));

beforeEach(() => {
  vi.clearAllMocks();
  clearSWRCache();
  localStorage.setItem('selected_database', 'old');
});
afterEach(() => { localStorage.clear(); clearSWRCache(); });

it.each(['success', 'error'])('ignores an old database %s after switching during a dashboard request', async (outcome) => {
  let resolveOld;
  let rejectOld;
  const oldRequest = new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
  const newPayload = { grouped: {}, totals: { devices: 42 }, db_id: 'new' };
  mfuAPI.getDevices.mockReturnValueOnce(oldRequest).mockResolvedValue(newPayload);
  render(<Mfu />);
  await waitFor(() => expect(mfuAPI.getDevices).toHaveBeenCalledTimes(1));
  act(() => {
    localStorage.setItem('selected_database', 'new');
    window.dispatchEvent(new Event('database-changed'));
  });
  await waitFor(() => expect(mfuAPI.getDevices).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('42')).toBeVisible();
  await act(async () => {
    if (outcome === 'error') rejectOld(new Error('OLD_DATABASE_ERROR'));
    else resolveOld({ grouped: {}, totals: { devices: 99 }, db_id: 'old' });
    await oldRequest.catch(() => {});
  });
  expect(screen.getByText('42')).toBeVisible();
  expect(screen.queryByText('99')).not.toBeInTheDocument();
  expect(screen.queryByText('OLD_DATABASE_ERROR')).not.toBeInTheDocument();
  const cached = peekSWRCache(buildCacheKey('mfu-dashboard', 7, 'new', 365, 8, 5000));
  expect(cached.data.db_id).toBe('new');
});
