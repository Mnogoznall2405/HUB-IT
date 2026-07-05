import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { buildCacheKey, getOrFetchSWR } from '../../lib/swrCache';
import { DATA_MODE_CONSUMABLES, DATA_MODE_EQUIPMENT } from './equipmentModel';
import { useDatabaseEquipmentData } from './useDatabaseEquipmentData';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    getTypes: vi.fn(),
    getStatuses: vi.fn(),
    getBranchesList: vi.fn(),
    getAllEquipmentGrouped: vi.fn(),
    getAllConsumablesGrouped: vi.fn(),
  },
}));

vi.mock('../../lib/swrCache', () => ({
  buildCacheKey: vi.fn((...parts) => parts.join('|')),
  getOrFetchSWR: vi.fn(async (_cacheKey, fetcher) => ({ data: await fetcher() })),
}));

const firstItem = { INV_NO: '1001', MODEL_NAME: 'OptiPlex' };
const secondItem = { INV_NO: '2001', MODEL_NAME: 'LaserJet' };

const createProps = (overrides = {}) => ({
  dataMode: DATA_MODE_EQUIPMENT,
  selectedBranch: '',
  getDbCacheScope: vi.fn(() => 'main'),
  staleTimeMs: 1234,
  pageLimit: 2,
  prefetchPages: 1,
  ...overrides,
});

describe('useDatabaseEquipmentData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equipmentAPI.getTypes.mockResolvedValue([{ type_no: 1 }]);
    equipmentAPI.getStatuses.mockResolvedValue([{ status_no: 1 }]);
    equipmentAPI.getBranchesList.mockResolvedValue([
      { BRANCH_NO: 1, BRANCH_NAME: 'HQ' },
      { BRANCH_NO: 2, BRANCH_NAME: 'Remote' },
    ]);
    equipmentAPI.getAllEquipmentGrouped.mockImplementation(async ({ page = 1 } = {}) => {
      if (page === 1) {
        return {
          grouped: { HQ: { Office: [firstItem] } },
          total: 2,
          pages: 2,
        };
      }
      return {
        grouped: { Remote: { Stock: [secondItem] } },
        total: 2,
        pages: 2,
      };
    });
    equipmentAPI.getAllConsumablesGrouped.mockResolvedValue({
      grouped: { Consumables: { Stock: [secondItem] } },
      total: 1,
      pages: 1,
    });
  });

  it('loads dictionaries, first page, and prefetched next page on mount', async () => {
    const { result } = renderHook(() => useDatabaseEquipmentData(createProps()));

    await waitFor(() => expect(result.current.loadedCount).toBe(2));
    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    expect(result.current.equipmentTypes).toEqual([{ type_no: 1, type_name: '', TYPE_NAME: '' }]);
    expect(result.current.statuses).toEqual([{ status_no: 1, status_name: '', STATUS_NAME: '' }]);
    expect(result.current.branches).toHaveLength(2);
    expect(result.current.allEquipment).toEqual({
      HQ: { Office: [firstItem] },
      Remote: { Stock: [secondItem] },
    });
    expect(result.current.serverTotal).toBe(2);
    expect(result.current.nextEquipmentPage).toBeNull();
    expect(equipmentAPI.getAllEquipmentGrouped).toHaveBeenCalledWith({ page: 1, limit: 2 });
    expect(equipmentAPI.getAllEquipmentGrouped).toHaveBeenCalledWith({ page: 2, limit: 2 });
    expect(getOrFetchSWR).toHaveBeenCalledWith(
      'equipment-grouped|main|1|2',
      expect.any(Function),
      { staleTimeMs: 1234, force: false }
    );
  });

  it('filters displayed equipment by selected branch without shrinking allEquipment', async () => {
    const { result, rerender } = renderHook((props) => useDatabaseEquipmentData(props), {
      initialProps: createProps({ prefetchPages: 0 }),
    });

    await waitFor(() => expect(result.current.initialLoadDone).toBe(true));

    rerender(createProps({ selectedBranch: 'HQ', prefetchPages: 0 }));

    await waitFor(() => expect(result.current.total).toBe(1));
    expect(result.current.equipment).toEqual({ HQ: { Office: [firstItem] } });
    expect(result.current.allEquipment).toEqual({ HQ: { Office: [firstItem] } });
  });

  it('uses consumables endpoint in consumables mode', async () => {
    const { result } = renderHook(() => useDatabaseEquipmentData(createProps({
      dataMode: DATA_MODE_CONSUMABLES,
      prefetchPages: 0,
    })));

    await waitFor(() => expect(result.current.loadedCount).toBe(1));

    expect(equipmentAPI.getAllConsumablesGrouped).toHaveBeenCalledWith({ page: 1, limit: 2 });
    expect(equipmentAPI.getAllEquipmentGrouped).not.toHaveBeenCalled();
    expect(buildCacheKey).toHaveBeenCalledWith('consumables-grouped', 'main', 1, 2);
  });

  it('restores cached mode data without refetching grouped pages', async () => {
    const { result } = renderHook(() => useDatabaseEquipmentData(createProps({ prefetchPages: 0 })));

    await waitFor(() => expect(result.current.initialLoadDone).toBe(true));
    const equipmentCallsBeforeSwitch = equipmentAPI.getAllEquipmentGrouped.mock.calls.length;

    await act(async () => {
      await result.current.switchDataMode(DATA_MODE_CONSUMABLES);
    });

    await waitFor(() => expect(result.current.loadedCount).toBe(1));
    expect(equipmentAPI.getAllConsumablesGrouped).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.switchDataMode(DATA_MODE_EQUIPMENT);
    });

    expect(result.current.allEquipment).toEqual({ HQ: { Office: [firstItem] } });
    expect(equipmentAPI.getAllEquipmentGrouped.mock.calls.length).toBe(equipmentCallsBeforeSwitch);
    expect(result.current.modeLoading).toBe(false);
  });

  it('resets loaded equipment state and can force refresh', async () => {
    const { result } = renderHook(() => useDatabaseEquipmentData(createProps({ prefetchPages: 0 })));

    await waitFor(() => expect(result.current.loadedCount).toBe(1));

    act(() => {
      result.current.resetEquipmentData();
    });

    expect(result.current.loadedCount).toBe(0);
    expect(result.current.equipment).toEqual({});
    expect(result.current.nextEquipmentPage).toBeNull();

    await act(async () => {
      await result.current.refreshCurrentDbData({ force: true });
    });

    expect(getOrFetchSWR).toHaveBeenLastCalledWith(
      'equipment-grouped|main|1|2',
      expect.any(Function),
      { staleTimeMs: 1234, force: true }
    );
  });
});
