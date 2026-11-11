import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseWorkspaceIdentity } from './useDatabaseWorkspaceIdentity';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    identifyWorkspace: vi.fn(),
  },
}));

const createProps = (overrides = {}) => ({
  setSearchQuery: vi.fn(),
  runSearchNow: vi.fn(),
  setSelectedItems: vi.fn(),
  notifyDatabaseSuccess: vi.fn(),
  notifyDatabaseError: vi.fn(),
  selectionDelayMs: 300,
  ...overrides,
});

describe('useDatabaseWorkspaceIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches by detected owner, schedules linked inventory selection and reports success', async () => {
    equipmentAPI.identifyWorkspace.mockResolvedValue({
      success: true,
      message: 'ПК найден',
      total_items_count: 2,
      owner_info: { owner_name: 'Ivan Petrov' },
      linked_inv_nos: [1001, '1002'],
    });
    const props = createProps();
    const { result } = renderHook(() => useDatabaseWorkspaceIdentity(props));

    await act(async () => {
      await result.current.handleIdentifyWorkspace();
    });

    expect(props.setSearchQuery).toHaveBeenCalledWith('Ivan Petrov');
    expect(props.runSearchNow).toHaveBeenCalledWith('Ivan Petrov');
    expect(props.notifyDatabaseSuccess).toHaveBeenCalledWith(
      'ПК найден. Найдено 2 ед. оборудования. Связанные отмечены галочками.'
    );
    expect(props.setSelectedItems).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(props.setSelectedItems).toHaveBeenCalledWith(['1001', '1002']);
    expect(result.current.identifyPCLoading).toBe(false);
  });

  it('reports backend miss messages without changing search state', async () => {
    equipmentAPI.identifyWorkspace.mockResolvedValue({
      success: false,
      message: 'not found',
    });
    const props = createProps();
    const { result } = renderHook(() => useDatabaseWorkspaceIdentity(props));

    await act(async () => {
      await result.current.handleIdentifyWorkspace();
    });

    expect(props.setSearchQuery).not.toHaveBeenCalled();
    expect(props.setSelectedItems).not.toHaveBeenCalled();
    expect(props.notifyDatabaseError).toHaveBeenCalledWith('not found');
    expect(result.current.identifyPCLoading).toBe(false);
  });

  it('reports API failures and clears loading', async () => {
    equipmentAPI.identifyWorkspace.mockRejectedValue({
      response: { data: { detail: 'network failed' } },
    });
    const props = createProps();
    const { result } = renderHook(() => useDatabaseWorkspaceIdentity(props));

    await act(async () => {
      await result.current.handleIdentifyWorkspace();
    });

    expect(props.notifyDatabaseError).toHaveBeenCalledWith(
      'Ошибка при определении рабочего места: network failed'
    );
    expect(result.current.identifyPCLoading).toBe(false);
  });
});
