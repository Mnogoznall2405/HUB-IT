import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseConsumableQty } from './useDatabaseConsumableQty';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    updateConsumableQty: vi.fn(),
  },
}));

const item = {
  ID: 12,
  INV_NO: '5001',
  MODEL_NAME: 'HP 12A',
  QTY: 3,
};

const createProps = (overrides = {}) => ({
  canDatabaseWrite: true,
  fetchAllEquipment: vi.fn(),
  notifyDatabaseSuccess: vi.fn(),
  ...overrides,
});

describe('useDatabaseConsumableQty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equipmentAPI.updateConsumableQty.mockResolvedValue({});
  });

  it('opens with the current quantity and ignores invalid/no-write opens', () => {
    const blocked = renderHook(() => useDatabaseConsumableQty(createProps({ canDatabaseWrite: false })));

    act(() => {
      blocked.result.current.openEditConsumableQtyModal(item);
    });
    expect(blocked.result.current.editConsumableQtyModal.open).toBe(false);

    const { result } = renderHook(() => useDatabaseConsumableQty(createProps()));
    act(() => {
      result.current.openEditConsumableQtyModal(item);
    });

    expect(result.current.editConsumableQtyModal).toMatchObject({ open: true, item });
    expect(result.current.editConsumableQtyValue).toBe('3');
  });

  it('validates quantity before calling API', async () => {
    const { result } = renderHook(() => useDatabaseConsumableQty(createProps()));

    act(() => {
      result.current.openEditConsumableQtyModal(item);
      result.current.setEditConsumableQtyInput('-1');
    });

    await act(async () => {
      await result.current.handleEditConsumableQtySubmit();
    });

    expect(equipmentAPI.updateConsumableQty).not.toHaveBeenCalled();
    expect(result.current.editConsumableQtyError).toBeTruthy();
  });

  it('submits quantity, closes modal, refreshes data and reports success', async () => {
    const props = createProps();
    const { result } = renderHook(() => useDatabaseConsumableQty(props));

    act(() => {
      result.current.openEditConsumableQtyModal(item);
      result.current.setEditConsumableQtyInput('7');
    });

    await act(async () => {
      await result.current.handleEditConsumableQtySubmit();
    });

    expect(equipmentAPI.updateConsumableQty).toHaveBeenCalledWith({
      item_id: 12,
      inv_no: '5001',
      qty: 7,
    });
    expect(props.notifyDatabaseSuccess).toHaveBeenCalled();
    expect(props.fetchAllEquipment).toHaveBeenCalledWith({ force: true });
    expect(result.current.editConsumableQtyModal.open).toBe(false);
    expect(result.current.editConsumableQtyLoading).toBe(false);
  });

  it('keeps modal open and shows API errors', async () => {
    equipmentAPI.updateConsumableQty.mockRejectedValue({
      response: { data: { detail: 'backend failed' } },
    });
    const { result } = renderHook(() => useDatabaseConsumableQty(createProps()));

    act(() => {
      result.current.openEditConsumableQtyModal(item);
      result.current.setEditConsumableQtyInput('5');
    });

    await act(async () => {
      await result.current.handleEditConsumableQtySubmit();
    });

    expect(result.current.editConsumableQtyModal.open).toBe(true);
    expect(result.current.editConsumableQtyError).toBe('backend failed');
    expect(result.current.editConsumableQtyLoading).toBe(false);
  });
});
