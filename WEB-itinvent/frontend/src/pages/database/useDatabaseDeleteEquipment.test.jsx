import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseDeleteEquipment } from './useDatabaseDeleteEquipment';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    deleteByInvNo: vi.fn(),
  },
}));

const grouped = {
  HQ: {
    Office: [
      { INV_NO: '1001', MODEL_NAME: 'LaserJet' },
      { INV_NO: '1002', MODEL_NAME: 'ThinkCentre' },
    ],
  },
};

const createStateSetter = (initialValue) => {
  let value = initialValue;
  const setter = vi.fn((next) => {
    value = typeof next === 'function' ? next(value) : next;
  });
  return { setter, get value() { return value; } };
};

const createProps = (overrides = {}) => ({
  isAdmin: true,
  setAllEquipment: vi.fn(),
  setFilteredData: vi.fn(),
  setSelectedItems: vi.fn(),
  setLoadedCount: vi.fn(),
  setServerTotal: vi.fn(),
  setTotal: vi.fn(),
  onDetailDeleted: vi.fn(),
  notifyDatabaseSuccess: vi.fn(),
  ...overrides,
});

describe('useDatabaseDeleteEquipment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equipmentAPI.deleteByInvNo.mockResolvedValue({});
  });

  it('opens only for admins with a valid inventory number', () => {
    const blocked = renderHook(() => useDatabaseDeleteEquipment(createProps({ isAdmin: false })));

    act(() => {
      blocked.result.current.openDeleteEquipmentDialog({ invNo: '1001' });
    });
    expect(blocked.result.current.deleteTarget).toBeNull();

    const { result } = renderHook(() => useDatabaseDeleteEquipment(createProps()));
    act(() => {
      result.current.openDeleteEquipmentDialog({
        invNo: ' 1001 ',
        item: { INV_NO: '1001' },
      });
    });

    expect(result.current.deleteTarget).toEqual({
      invNo: '1001',
      item: { INV_NO: '1001' },
    });
  });

  it('deletes equipment, prunes grouped data, clears selection and updates counters', async () => {
    const allEquipment = createStateSetter(grouped);
    const filteredData = createStateSetter(grouped);
    const selectedItems = createStateSetter(['1001', '1002']);
    const loadedCount = createStateSetter(2);
    const serverTotal = createStateSetter(2);
    const total = createStateSetter(2);
    const props = createProps({
      detailInvNo: '1001',
      setAllEquipment: allEquipment.setter,
      setFilteredData: filteredData.setter,
      setSelectedItems: selectedItems.setter,
      setLoadedCount: loadedCount.setter,
      setServerTotal: serverTotal.setter,
      setTotal: total.setter,
    });
    const { result } = renderHook(() => useDatabaseDeleteEquipment(props));

    act(() => {
      result.current.openDeleteEquipmentDialog({ invNo: '1001' });
    });
    await act(async () => {
      await result.current.confirmDeleteEquipment();
    });

    expect(equipmentAPI.deleteByInvNo).toHaveBeenCalledWith('1001');
    expect(allEquipment.value.HQ.Office).toEqual([{ INV_NO: '1002', MODEL_NAME: 'ThinkCentre' }]);
    expect(filteredData.value.HQ.Office).toEqual([{ INV_NO: '1002', MODEL_NAME: 'ThinkCentre' }]);
    expect(selectedItems.value).toEqual(['1002']);
    expect(loadedCount.value).toBe(1);
    expect(serverTotal.value).toBe(1);
    expect(total.value).toBe(1);
    expect(props.onDetailDeleted).toHaveBeenCalled();
    expect(props.notifyDatabaseSuccess).toHaveBeenCalledWith('Оборудование 1001 удалено.');
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.deleteLoading).toBe(false);
  });

  it('keeps dialog open and surfaces API errors', async () => {
    equipmentAPI.deleteByInvNo.mockRejectedValue({
      response: { data: { detail: 'delete failed' } },
    });
    const { result } = renderHook(() => useDatabaseDeleteEquipment(createProps()));

    act(() => {
      result.current.openDeleteEquipmentDialog({ invNo: '1001' });
    });
    await act(async () => {
      await result.current.confirmDeleteEquipment();
    });

    expect(result.current.deleteTarget).toEqual({ invNo: '1001', item: null });
    expect(result.current.deleteError).toBe('delete failed');
    expect(result.current.deleteLoading).toBe(false);
  });
});
