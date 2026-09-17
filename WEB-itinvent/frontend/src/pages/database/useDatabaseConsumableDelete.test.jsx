import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseConsumableDelete } from './useDatabaseConsumableDelete';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    deleteConsumable: vi.fn(),
  },
}));

const item = {
  ID: 12,
  INV_NO: '5001',
  MODEL_NAME: 'HP 12A',
  QTY: 3,
};

const grouped = { HQ: { Office: [item, { ID: 13, INV_NO: '5002', MODEL_NAME: 'Other' }] } };

const createProps = (overrides = {}) => ({
  canDatabaseDelete: true,
  fetchAllEquipment: vi.fn(),
  setAllEquipment: vi.fn(),
  setFilteredData: vi.fn(),
  setSelectedItems: vi.fn(),
  setLoadedCount: vi.fn(),
  setServerTotal: vi.fn(),
  setTotal: vi.fn(),
  notifyDatabaseSuccess: vi.fn(),
  ...overrides,
});

describe('useDatabaseConsumableDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equipmentAPI.deleteConsumable.mockResolvedValue({ success: true });
  });

  it('removes the row point-wise and decrements counters without a full refetch', async () => {
    const props = createProps();
    const { result } = renderHook(() => useDatabaseConsumableDelete(props));

    act(() => {
      result.current.openDeleteConsumableModal(item);
    });
    expect(result.current.deleteConsumableTarget?.invNo).toBe('5001');

    await act(async () => {
      await result.current.confirmDeleteConsumable();
    });

    expect(equipmentAPI.deleteConsumable).toHaveBeenCalledWith(12);
    expect(props.fetchAllEquipment).not.toHaveBeenCalled();

    const updater = props.setAllEquipment.mock.calls[0][0];
    const next = updater(grouped);
    expect(next.HQ.Office).toHaveLength(1);
    expect(next.HQ.Office[0].INV_NO).toBe('5002');

    expect(props.setLoadedCount).toHaveBeenCalledWith(expect.any(Function));
    expect(props.setServerTotal).toHaveBeenCalledWith(expect.any(Function));
    expect(props.setTotal).toHaveBeenCalledWith(expect.any(Function));
    expect(props.setLoadedCount.mock.calls[0][0](5)).toBe(4);
    expect(result.current.deleteConsumableTarget).toBeNull();
    expect(props.notifyDatabaseSuccess).toHaveBeenCalled();
  });

  it('falls back to a full refetch when grouped setters are unavailable', async () => {
    const props = createProps({ setAllEquipment: undefined });
    const { result } = renderHook(() => useDatabaseConsumableDelete(props));

    act(() => {
      result.current.openDeleteConsumableModal(item);
    });
    await act(async () => {
      await result.current.confirmDeleteConsumable();
    });

    expect(props.fetchAllEquipment).toHaveBeenCalledWith({ force: true });
  });
});
