import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import jsonAPI from '../../api/json_client';
import { getComponentLabel } from './equipmentModel';
import { useDatabaseMaintenanceData } from './useDatabaseMaintenanceData';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    lookupConsumables: vi.fn(),
    getAllConsumablesGrouped: vi.fn(),
  },
}));

vi.mock('../../api/json_client', () => ({
  default: {
    getCartridgeReplacementHistory: vi.fn(),
    getBatteryReplacementHistory: vi.fn(),
    getComponentReplacementHistory: vi.fn(),
    getPcCleaningHistory: vi.fn(),
  },
}));

const cartridgeOption = {
  ID: 11,
  TYPE_NAME: 'Toner cartridge',
  MODEL_NAME: 'HP 12A',
  QTY: 3,
};

const componentOption = {
  ID: 22,
  TYPE_NAME: 'Spare part',
  MODEL_NAME: 'Fuser unit',
  QTY: 2,
};

const createProps = (overrides = {}) => ({
  actionModal: { open: false, type: null, componentKind: null },
  resolveSingleActionTarget: vi.fn(() => ({ multiple: false, item: null })),
  componentType: 'fuser',
  ...overrides,
});

describe('useDatabaseMaintenanceData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equipmentAPI.lookupConsumables.mockResolvedValue([]);
    equipmentAPI.getAllConsumablesGrouped.mockResolvedValue({ grouped: {} });
    jsonAPI.getCartridgeReplacementHistory.mockResolvedValue({ data: { count: 0 } });
    jsonAPI.getBatteryReplacementHistory.mockResolvedValue({ data: { count: 0 } });
    jsonAPI.getComponentReplacementHistory.mockResolvedValue({ data: { count: 0 } });
    jsonAPI.getPcCleaningHistory.mockResolvedValue({ data: { count: 0 } });
  });

  it('loads work consumables when the action needs them', async () => {
    equipmentAPI.lookupConsumables.mockResolvedValue([
      cartridgeOption,
      { ...cartridgeOption },
      { ID: null, TYPE_NAME: 'Broken row', MODEL_NAME: 'No id' },
      componentOption,
    ]);

    const { result } = renderHook((props) => useDatabaseMaintenanceData(props), {
      initialProps: createProps({
        actionModal: { open: true, type: 'component', componentKind: 'printer' },
      }),
    });

    await waitFor(() => expect(result.current.workConsumableOptions).toHaveLength(2));

    expect(equipmentAPI.lookupConsumables).toHaveBeenCalledWith({
      only_positive_qty: true,
      limit: 500,
    });
    expect(result.current.workConsumablesLoading).toBe(false);
    expect(result.current.workConsumableOptions.map((entry) => entry.id)).toEqual([11, 22]);
  });

  it('filters action work consumables and resets an invalid selected consumable', async () => {
    equipmentAPI.lookupConsumables.mockResolvedValue([cartridgeOption, componentOption]);

    const { result } = renderHook((props) => useDatabaseMaintenanceData(props), {
      initialProps: createProps({
        actionModal: { open: true, type: 'cartridge', componentKind: 'printer' },
      }),
    });

    await waitFor(() => expect(result.current.workConsumableOptions).toHaveLength(2));
    expect(result.current.actionWorkConsumableOptions.map((entry) => entry.id)).toEqual([11]);

    act(() => {
      result.current.setSelectedWorkConsumable(result.current.workConsumableOptions[1]);
    });

    await waitFor(() => expect(result.current.selectedWorkConsumable).toBeNull());
  });

  it('loads cartridge history for the resolved target item', async () => {
    const history = { count: 2, last_date: '2026-05-01', time_ago_str: '2 days' };
    jsonAPI.getCartridgeReplacementHistory.mockResolvedValue({ data: history });

    const { result } = renderHook((props) => useDatabaseMaintenanceData(props), {
      initialProps: createProps({
        actionModal: { open: true, type: 'cartridge', componentKind: 'printer' },
        resolveSingleActionTarget: vi.fn(() => ({
          multiple: false,
          item: { SERIAL_NO: 'SN-1', HW_SERIAL_NO: 'HW-1', INV_NO: '1001' },
        })),
      }),
    });

    await waitFor(() => expect(result.current.cartridgeHistory).toEqual(history));

    expect(jsonAPI.getCartridgeReplacementHistory).toHaveBeenCalledWith(
      'SN-1',
      'HW-1',
      '1001',
      undefined,
      undefined
    );
  });

  it('loads component history with the current component option label', async () => {
    const history = { count: 1, last_date: '2026-05-02', time_ago_str: '1 day' };
    jsonAPI.getComponentReplacementHistory.mockResolvedValue({ data: history });

    const { result } = renderHook((props) => useDatabaseMaintenanceData(props), {
      initialProps: createProps({
        actionModal: { open: true, type: 'component', componentKind: 'pc' },
        componentType: 'ram',
        resolveSingleActionTarget: vi.fn(() => ({
          multiple: false,
          item: { SERIAL_NO: 'PC-SN', HW_SERIAL_NO: 'PC-HW' },
        })),
      }),
    });

    await waitFor(() => expect(result.current.componentHistory).toEqual(history));

    expect(jsonAPI.getComponentReplacementHistory).toHaveBeenCalledWith(
      'PC-SN',
      'PC-HW',
      'ram',
      getComponentLabel('pc', 'ram')
    );
  });
});
