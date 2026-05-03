import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { databaseAPI } from '../../api/database';
import { useDatabaseSelection } from './useDatabaseSelection';

vi.mock('../../api/database', () => ({
  databaseAPI: {
    getCurrentDatabase: vi.fn(),
    getAvailableDatabases: vi.fn(),
    switchDatabase: vi.fn(),
  },
}));

describe('useDatabaseSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    databaseAPI.getCurrentDatabase.mockResolvedValue({
      id: 'main',
      name: 'Основная база',
    });
    databaseAPI.getAvailableDatabases.mockResolvedValue([
      { id: 'main', name: 'Основная база' },
      { id: 'archive', name: 'Архив' },
    ]);
    databaseAPI.switchDatabase.mockImplementation(async (id) => ({
      success: true,
      database: { id, name: id === 'archive' ? 'Архив' : 'Основная база' },
    }));
  });

  it('loads current database, available databases and selected name', async () => {
    const { result } = renderHook(() => useDatabaseSelection());

    await waitFor(() => expect(result.current.dbName).toBe('main'));

    expect(result.current.databases).toHaveLength(2);
    expect(result.current.currentDb).toEqual({ id: 'main', name: 'Основная база' });
    expect(result.current.selectedDatabaseName).toBe('Основная база');
    expect(localStorage.getItem('selected_database')).toBe('main');
  });

  it('switches database through the server and dispatches database-changed', async () => {
    const listener = vi.fn();
    window.addEventListener('database-changed', listener);
    const { result } = renderHook(() => useDatabaseSelection());

    await waitFor(() => expect(result.current.dbName).toBe('main'));
    databaseAPI.getCurrentDatabase.mockResolvedValue({
      id: 'archive',
      name: 'Архив',
    });

    await act(async () => {
      await result.current.handleDatabaseSelectChange({ target: { value: 'archive' } });
    });

    expect(databaseAPI.switchDatabase).toHaveBeenCalledWith('archive');
    expect(result.current.dbName).toBe('archive');
    expect(result.current.selectedDatabaseName).toBe('Архив');
    expect(localStorage.getItem('selected_database')).toBe('archive');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('database-changed', listener);
  });

  it('keeps the previous database and reports switch errors', async () => {
    const notifyDatabaseError = vi.fn();
    databaseAPI.switchDatabase.mockRejectedValueOnce({
      response: { data: { detail: 'Нет доступа' } },
    });
    const { result } = renderHook(() => useDatabaseSelection({ notifyDatabaseError }));

    await waitFor(() => expect(result.current.dbName).toBe('main'));

    await act(async () => {
      await result.current.handleDatabaseSelectChange({ target: { value: 'archive' } });
    });

    expect(result.current.dbName).toBe('main');
    expect(notifyDatabaseError).toHaveBeenCalledWith('Нет доступа');
  });

  it('reacts to external database-changed events', async () => {
    const { result } = renderHook(() => useDatabaseSelection());

    await waitFor(() => expect(result.current.dbName).toBe('main'));

    databaseAPI.getCurrentDatabase.mockResolvedValueOnce({
      id: 'archive',
      name: 'Архив',
    });
    localStorage.setItem('selected_database', 'archive');

    act(() => {
      window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: 'archive' } }));
    });

    await waitFor(() => expect(result.current.dbName).toBe('archive'));
    expect(result.current.selectedDatabaseName).toBe('Архив');
  });
});
