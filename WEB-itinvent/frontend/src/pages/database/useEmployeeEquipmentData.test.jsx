import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useEmployeeEquipmentData from './useEmployeeEquipmentData';

const getEmployeeWarehouse = vi.fn();
const getWarehouseMovements = vi.fn();

vi.mock('../../api/equipmentSearch', () => ({
  equipmentSearchAPI: { getEmployeeEquipment: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../api/warehouse1c', () => ({
  warehouse1cAPI: {
    getEmployeeWarehouse: (...args) => getEmployeeWarehouse(...args),
    getWarehouseMovements: (...args) => getWarehouseMovements(...args),
  },
}));

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const renderData = (employeeName) => renderHook(
  (props) => useEmployeeEquipmentData({
    open: true, ownerNo: 0, canViewWarehouse1C: true, ...props,
  }),
  { initialProps: { employeeName } },
);

describe('useEmployeeEquipmentData warehouse movements', () => {
  beforeEach(() => {
    getEmployeeWarehouse.mockReset();
    getWarehouseMovements.mockReset();
    getEmployeeWarehouse.mockImplementation(async ({ employeeName }) => ({
      status: 'matched',
      warehouse: { ref: `ref-${employeeName}` },
      balances: [],
    }));
  });

  it('does not write the previous employee\'s late movements into the new employee view', async () => {
    const late = deferred();
    getWarehouseMovements.mockReturnValueOnce(late.promise);
    const { result, rerender } = renderData('A');
    await waitFor(() => expect(result.current.warehouseInfo?.ref).toBe('ref-A'));

    act(() => { result.current.handleMovementsDatesChange('2026-01-01', '2026-01-31'); });
    expect(result.current.movementsLoading).toBe(true);

    rerender({ employeeName: 'B' });
    await waitFor(() => expect(result.current.warehouseInfo?.ref).toBe('ref-B'));
    await act(async () => { late.resolve({ items: [{ id: 'from-A' }] }); await late.promise; });

    expect(result.current.warehouseMovements).toEqual([]);
    expect(result.current.movementsLoaded).toBe(false);
    expect(result.current.movementsLoading).toBe(false);
  });

  it('keeps the newest date range when an older request answers last', async () => {
    const first = deferred();
    const second = deferred();
    getWarehouseMovements.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderData('A');
    await waitFor(() => expect(result.current.warehouseInfo?.ref).toBe('ref-A'));

    act(() => { result.current.handleMovementsDatesChange('2026-01-01', '2026-01-31'); });
    act(() => { result.current.handleMovementsDatesChange('2026-02-01', '2026-02-28'); });
    await act(async () => { second.resolve({ items: [{ id: 'feb' }] }); await second.promise; });
    await act(async () => { first.resolve({ items: [{ id: 'jan' }] }); await first.promise; });

    expect(result.current.warehouseMovements).toEqual([{ id: 'feb' }]);
    expect(result.current.movementsLoading).toBe(false);
  });
});
