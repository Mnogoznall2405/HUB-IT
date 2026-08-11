import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDatabaseEmployeeFallback } from './useDatabaseEmployeeFallback';

const { searchByEmployee, getEmployeeWarehouse } = vi.hoisted(() => ({
  searchByEmployee: vi.fn(),
  getEmployeeWarehouse: vi.fn(),
}));

vi.mock('../../api/equipmentSearch', () => ({
  equipmentSearchAPI: { searchByEmployee },
}));

vi.mock('../../api/warehouse1c', () => ({
  warehouse1cAPI: { getEmployeeWarehouse },
}));

const baseProps = {
  enabled: true,
  searchQuery: 'Иванов',
  appliedSearchQuery: 'Иванов',
  hubSearchEmpty: true,
};

describe('useDatabaseEmployeeFallback', () => {
  beforeEach(() => {
    searchByEmployee.mockReset();
    getEmployeeWarehouse.mockReset();
    searchByEmployee.mockResolvedValue({ employees: [] });
    getEmployeeWarehouse.mockResolvedValue({ status: 'not_found', candidates: [] });
  });

  it('does not run before the local empty search is applied or without permission', async () => {
    const { rerender } = renderHook(
      (props) => useDatabaseEmployeeFallback(props),
      { initialProps: { ...baseProps, appliedSearchQuery: 'Петров' } },
    );

    await act(async () => {});
    expect(searchByEmployee).not.toHaveBeenCalled();

    rerender({ ...baseProps, enabled: false });
    await act(async () => {});
    expect(searchByEmployee).not.toHaveBeenCalled();

    rerender({ ...baseProps, searchQuery: 'И', appliedSearchQuery: 'И' });
    await act(async () => {});
    expect(searchByEmployee).not.toHaveBeenCalled();

    rerender({ ...baseProps, hubSearchEmpty: false });
    await act(async () => {});
    expect(searchByEmployee).not.toHaveBeenCalled();
  });

  it('uses the single Hub employee full name for the 1C warehouse lookup', async () => {
    const employee = {
      owner_no: 42,
      name: 'Иванов Иван Иванович',
      department: 'ИТ',
      equipment_count: 0,
    };
    searchByEmployee.mockResolvedValue({ employees: [employee] });
    getEmployeeWarehouse.mockResolvedValue({
      status: 'matched',
      warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
      candidates: [],
      balances: [{ qty_balance: 2 }, { qty_balance: 1 }],
    });

    const { result } = renderHook(() => useDatabaseEmployeeFallback(baseProps));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(searchByEmployee).toHaveBeenCalledWith(
      'Иванов',
      1,
      10,
      { signal: expect.any(AbortSignal) },
    );
    expect(getEmployeeWarehouse).toHaveBeenCalledWith({
      employeeName: 'Иванов Иван Иванович',
      warehouseRef: '',
      loadBalances: true,
      signal: expect.any(AbortSignal),
    });
    expect(result.current.employees).toEqual([employee]);
    expect(result.current.warehouse).toEqual({ ref: 'wh-1', name: 'Иванов И.И.' });
    expect(result.current.warehouseQuantity).toBe(3);
  });

  it('shows 1C quantities for multiple Hub employees before the user chooses one', async () => {
    searchByEmployee.mockResolvedValue({
      employees: [
        { owner_no: 1, name: 'Иванов Иван', equipment_count: 0 },
        { owner_no: 2, name: 'Иванов Пётр', equipment_count: 3 },
      ],
    });
    getEmployeeWarehouse.mockImplementation(({ employeeName }) => Promise.resolve({
      status: 'matched',
      warehouse: { ref: employeeName.includes('Пётр') ? 'wh-2' : 'wh-1', name: employeeName },
      candidates: [],
      balances: [{ qty_balance: employeeName.includes('Пётр') ? 5 : 2 }],
    }));

    const { result } = renderHook(() => useDatabaseEmployeeFallback(baseProps));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.employees).toHaveLength(2);
    expect(getEmployeeWarehouse).toHaveBeenCalledTimes(2);
    expect(getEmployeeWarehouse).toHaveBeenCalledWith(expect.objectContaining({
      employeeName: 'Иванов Иван',
      loadBalances: true,
    }));
    expect(result.current.employeeWarehouseResults['1'].quantity).toBe(2);
    expect(result.current.employeeWarehouseResults['2'].quantity).toBe(5);
  });

  it('searches 1C by the raw query when the employee is absent from Hub', async () => {
    getEmployeeWarehouse.mockResolvedValue({
      status: 'ambiguous',
      warehouse: null,
      candidates: [
        { ref: 'wh-1', name: 'Иванов И.И.' },
        { ref: 'wh-2', name: 'Иванов П.П.' },
      ],
    });

    const { result } = renderHook(() => useDatabaseEmployeeFallback(baseProps));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getEmployeeWarehouse).toHaveBeenCalledWith(expect.objectContaining({
      employeeName: 'Иванов',
      loadBalances: true,
    }));
    expect(result.current.warehouseStatus).toBe('ambiguous');
    expect(result.current.warehouseCandidates).toHaveLength(2);
  });

  it('ignores a stale response after the query changes', async () => {
    let resolveFirst;
    const firstRequest = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    searchByEmployee
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({ employees: [] });
    getEmployeeWarehouse.mockResolvedValue({ status: 'not_found', candidates: [] });

    const { result, rerender } = renderHook(
      (props) => useDatabaseEmployeeFallback(props),
      { initialProps: baseProps },
    );

    await waitFor(() => expect(searchByEmployee).toHaveBeenCalledTimes(1));
    const firstSignal = searchByEmployee.mock.calls[0][3].signal;
    rerender({
      ...baseProps,
      searchQuery: 'Петров',
      appliedSearchQuery: 'Петров',
    });

    expect(firstSignal.aborted).toBe(true);
    await waitFor(() => expect(searchByEmployee).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.query).toBe('Петров'));

    await act(async () => {
      resolveFirst({ employees: [{ owner_no: 99, name: 'Старый ответ' }] });
      await firstRequest;
    });

    expect(result.current.query).toBe('Петров');
    expect(result.current.employees).toEqual([]);
  });

  it('keeps the 1C result when the Hub employee directory fails', async () => {
    searchByEmployee.mockRejectedValue(new Error('Hub unavailable'));
    getEmployeeWarehouse.mockResolvedValue({
      status: 'matched',
      warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
      candidates: [],
    });

    const { result } = renderHook(() => useDatabaseEmployeeFallback(baseProps));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.employeeError).toContain('справочник сотрудников');
    expect(result.current.warehouseStatus).toBe('matched');
  });

  it('exposes the 1C not-found state after both searches complete', async () => {
    const { result } = renderHook(() => useDatabaseEmployeeFallback(baseProps));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.employees).toEqual([]);
    expect(result.current.warehouseStatus).toBe('not_found');
    expect(result.current.warehouseError).toBe('');
  });

  it('exposes a separate 1C error without discarding the Hub employee', async () => {
    const employee = { owner_no: 42, name: 'Иванов Иван Иванович', equipment_count: 0 };
    searchByEmployee.mockResolvedValue({ employees: [employee] });
    getEmployeeWarehouse.mockRejectedValue(new Error('1C unavailable'));

    const { result } = renderHook(() => useDatabaseEmployeeFallback(baseProps));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.employees).toEqual([employee]);
    expect(result.current.warehouseStatus).toBe('');
    expect(result.current.warehouseError).toContain('склад сотрудника в 1С');
  });
});
