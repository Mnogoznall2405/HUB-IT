import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseAddWorkflows } from './useDatabaseAddWorkflows';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    createEquipment: vi.fn(),
    createConsumable: vi.fn(),
    searchBySerial: vi.fn(),
  },
}));

const branchOptions = [
  { branch_no: 1, branch_name: 'HQ' },
  { branch_no: 2, branch_name: 'Remote' },
];

const statusOptions = [
  { status_no: 5, status_name: 'В работе' },
];

const createProps = (overrides = {}) => ({
  canDatabaseWrite: true,
  selectedBranch: 'HQ',
  branchOptions,
  statusOptions,
  searchOwnersCached: vi.fn(async () => ({ owners: [] })),
  getLocationsCached: vi.fn(async () => []),
  getModelsCached: vi.fn(async () => ({ models: [] })),
  fetchAllEquipment: vi.fn(),
  notifyDatabaseSuccess: vi.fn(),
  ...overrides,
});

describe('useDatabaseAddWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equipmentAPI.createEquipment.mockResolvedValue({
      inv_no: '1001',
      model_name: 'OptiPlex',
    });
    equipmentAPI.createConsumable.mockResolvedValue({
      id: 44,
      model_name: 'Toner',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens add-equipment with branch/status defaults and loads dependent locations and models', async () => {
    const props = createProps({
      getLocationsCached: vi.fn(async () => [{ LOC_NO: 10, LOCATION_NAME: 'Office' }]),
      getModelsCached: vi.fn(async () => ({ models: [{ MODEL_NO: 7, MODEL_NAME: 'OptiPlex' }] })),
    });
    const { result } = renderHook(() => useDatabaseAddWorkflows(props));

    act(() => {
      result.current.openAddEquipmentModal();
    });

    expect(result.current.addEquipmentModalOpen).toBe(true);
    expect(result.current.addEquipmentForm.branch_no).toBe('1');
    expect(result.current.addEquipmentForm.status_no).toBe('5');

    act(() => {
      result.current.patchAddEquipmentForm({ type_no: 3 });
    });

    await waitFor(() => expect(result.current.addLocationOptions).toHaveLength(1));
    await waitFor(() => expect(result.current.addModelOptions).toHaveLength(1));
    expect(props.getLocationsCached).toHaveBeenCalledWith('1', { onlyBranch: true });
    expect(props.getModelsCached).toHaveBeenCalledWith(3);
  });

  it('loads rooms of the chosen branch only and widens to all rooms on request', async () => {
    const props = createProps({
      getLocationsCached: vi.fn(async () => [{ LOC_NO: 10, LOCATION_NAME: 'Office' }]),
    });
    const { result } = renderHook(() => useDatabaseAddWorkflows(props));

    act(() => {
      result.current.openAddEquipmentModal();
    });
    await waitFor(() => expect(result.current.addLocationOptions).toHaveLength(1));
    expect(props.getLocationsCached).toHaveBeenLastCalledWith('1', { onlyBranch: true });

    act(() => {
      result.current.setAddShowAllLocations(true);
    });
    await waitFor(() => expect(props.getLocationsCached).toHaveBeenLastCalledWith('1', undefined));
  });

  it('debounces add-equipment owner search and dedupes the selected owner', async () => {
    vi.useFakeTimers();
    const props = createProps({
      searchOwnersCached: vi.fn(async () => ({
        owners: [
          { OWNER_NO: 77, OWNER_DISPLAY_NAME: 'Ivan Petrov' },
          { OWNER_NO: 77, OWNER_DISPLAY_NAME: 'Ivan Petrov duplicate' },
        ],
      })),
    });
    const { result } = renderHook(() => useDatabaseAddWorkflows(props));

    act(() => {
      result.current.openAddEquipmentModal();
      result.current.patchAddEquipmentForm({ employee_no: 77, employee_name: 'Ivan Petrov' });
      result.current.setAddEmployeeInput('Ivan');
    });

    await act(async () => {
      vi.advanceTimersByTime(280);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.addEmployeeOptions).toHaveLength(1);
    expect(props.searchOwnersCached).toHaveBeenCalledWith('Ivan', 20);
  });

  it('submits add-equipment, reports success and refreshes data', async () => {
    const props = createProps({
      getLocationsCached: vi.fn(async () => [{ LOC_NO: 10, LOCATION_NAME: 'Office' }]),
    });
    const { result } = renderHook(() => useDatabaseAddWorkflows(props));

    act(() => {
      result.current.openAddEquipmentModal();
      result.current.patchAddEquipmentForm({
        serial_number: 'SN-100',
        employee_name: 'Ivan Petrov',
        type_no: 3,
        model_name: 'OptiPlex',
        status_no: 5,
        branch_no: 1,
        loc_no: 10,
      });
    });

    await act(async () => {
      await result.current.handleAddEquipmentSubmit();
    });

    expect(equipmentAPI.createEquipment).toHaveBeenCalledWith(expect.objectContaining({
      employee_name: 'Ivan Petrov',
      type_no: 3,
      model_name: 'OptiPlex',
    }));
    expect(props.notifyDatabaseSuccess).toHaveBeenCalled();
    expect(props.fetchAllEquipment).toHaveBeenCalledWith({ force: true });
    expect(result.current.addEquipmentLoading).toBe(false);
    // Batch entry: per-item fields are cleared, shared ones stay for the next unit.
    expect(result.current.addEquipmentForm).toMatchObject({
      serial_number: '',
      employee_name: 'Ivan Petrov',
      type_no: 3,
      model_name: 'OptiPlex',
      status_no: 5,
      branch_no: 1,
      loc_no: 10,
    });
  });

  it('warns about an already registered serial while typing and clears the warning for a new one', async () => {
    equipmentAPI.searchBySerial.mockImplementation(async (query) => ({
      found: true,
      equipment: [
        { SERIAL_NO: 'SN-100-B', INV_NO: 9 },
        ...(query === 'sn-100' ? [{ SERIAL_NO: 'SN-100', INV_NO: 55, model_name: 'OptiPlex', employee_name: 'Ivan Petrov' }] : []),
      ],
    }));
    const props = createProps();
    const { result } = renderHook(() => useDatabaseAddWorkflows(props));

    act(() => {
      result.current.openAddEquipmentModal();
      result.current.patchAddEquipmentForm({ serial_number: 'sn-100' });
    });
    await waitFor(() => expect(result.current.addSerialDuplicate).toEqual({
      inv_no: '55',
      model_name: 'OptiPlex',
      employee_name: 'Ivan Petrov',
    }));

    act(() => {
      result.current.patchAddEquipmentForm({ serial_number: 'sn-1000' });
    });
    await waitFor(() => expect(result.current.addSerialDuplicate).toBeNull());
  });

  it('remembers the saved combination as a preset and re-applies it in one step', async () => {
    window.localStorage.clear();
    const props = createProps({
      getLocationsCached: vi.fn(async () => [{ LOC_NO: 10, LOCATION_NAME: 'Office' }]),
    });
    const { result } = renderHook(() => useDatabaseAddWorkflows(props));

    act(() => {
      result.current.openAddEquipmentModal();
      result.current.patchAddEquipmentForm({
        serial_number: 'SN-200',
        employee_name: 'Ivan Petrov',
        employee_no: 77,
        type_no: '3',
        model_name: 'OptiPlex',
        status_no: '5',
        branch_no: '1',
        loc_no: '10',
      });
    });
    await act(async () => {
      await result.current.handleAddEquipmentSubmit();
    });

    expect(result.current.addRecentPresets).toHaveLength(1);
    const [preset] = result.current.addRecentPresets;
    expect(preset).toMatchObject({ type_no: '3', model_name: 'OptiPlex', employee_no: 77, branch_no: '1', loc_no: '10' });

    act(() => {
      result.current.closeAddEquipmentModal();
      result.current.openAddEquipmentModal();
    });
    expect(result.current.addEquipmentForm.type_no).toBe('');

    act(() => {
      result.current.applyAddEquipmentPreset(preset);
    });
    expect(result.current.addEquipmentForm).toMatchObject({
      type_no: '3',
      model_name: 'OptiPlex',
      employee_name: 'Ivan Petrov',
      employee_no: 77,
      loc_no: '10',
      serial_number: '',
    });
  });

  it('opens and submits add-consumable with location/model lookups', async () => {
    const props = createProps({
      getLocationsCached: vi.fn(async () => [{ LOC_NO: 10, LOCATION_NAME: 'Stock' }]),
      getModelsCached: vi.fn(async () => ({ models: [{ MODEL_NO: 8, MODEL_NAME: 'Toner' }] })),
    });
    const { result } = renderHook(() => useDatabaseAddWorkflows(props));

    act(() => {
      result.current.openAddConsumableModal();
      result.current.patchAddConsumableForm({
        type_no: 4,
        model_name: 'Toner',
        loc_no: 10,
        qty: 2,
      });
    });

    await waitFor(() => expect(result.current.addConsumableLocationOptions).toHaveLength(1));
    await waitFor(() => expect(result.current.addConsumableModelOptions).toHaveLength(1));

    await act(async () => {
      await result.current.handleAddConsumableSubmit();
    });

    expect(props.getModelsCached).toHaveBeenCalledWith(4, 4);
    expect(equipmentAPI.createConsumable).toHaveBeenCalled();
    expect(props.fetchAllEquipment).toHaveBeenCalledWith({ force: true });
  });
});
