import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CARTRIDGE_COLOR } from './equipmentModel';
import {
  executeMaintenanceAction,
  getActionErrorMessage,
} from './actionExecution';

const createPrinter = (overrides = {}) => ({
  INV_NO: 'PRN-1',
  ID: 101,
  TYPE_NAME: 'Printer',
  MODEL_NAME: 'HP LaserJet 400',
  SERIAL_NO: 'SN-PRN-1',
  OWNER_DISPLAY_NAME: 'Ivan Petrov',
  BRANCH_NAME: 'HQ',
  LOCATION: 'Room 101',
  DESCRIPTION: 'Office printer',
  HW_SERIAL_NO: 'HW-PRN-1',
  MANUFACTURER: 'HP',
  ...overrides,
});

const createPc = (overrides = {}) => ({
  INV_NO: 'PC-1',
  ID: 201,
  TYPE_NAME: 'PC',
  MODEL_NAME: 'Dell OptiPlex',
  SERIAL_NO: 'SN-PC-1',
  OWNER_DISPLAY_NAME: 'Anna Sidorova',
  BRANCH_NAME: 'HQ',
  LOCATION: 'Room 202',
  DESCRIPTION: 'Office workstation',
  HW_SERIAL_NO: 'HW-PC-1',
  MANUFACTURER: 'Dell',
  ...overrides,
});

const createExecutionContext = (items = []) => {
  const byInvNo = new Map(items.map((item) => [String(item.INV_NO || item.inv_no), item]));

  return {
    findEquipmentByInvNo: vi.fn((invNo) => byInvNo.get(invNo)),
    loadDetailedItemsByInvNos: vi.fn(async (invNos) => new Map(
      invNos
        .map((invNo) => [invNo, byInvNo.get(invNo)])
        .filter((entry) => Boolean(entry[1]))
    )),
    getItemBranch: vi.fn((item) => item?.BRANCH_NAME || item?.branch_name || ''),
    equipmentAPI: {
      consumeConsumable: vi.fn().mockResolvedValue({}),
      getByInvNos: vi.fn().mockResolvedValue({ equipment: [] }),
    },
    jsonAPI: {
      addCartridgeReplacement: vi.fn().mockResolvedValue({}),
      addBatteryReplacement: vi.fn().mockResolvedValue({}),
      addComponentReplacement: vi.fn().mockResolvedValue({}),
      addPcCleaning: vi.fn().mockResolvedValue({}),
    },
  };
};

const defaultConsumable = {
  id: 501,
  inv_no: 'CRT-501',
  model_name: 'CE505A',
  branch_name: 'HQ',
  location_name: 'Storage',
};

describe('getActionErrorMessage', () => {
  it('returns plain Error messages', () => {
    expect(getActionErrorMessage(new Error('plain failure'))).toBe('plain failure');
  });

  it('returns string response details before the generic error message', () => {
    expect(getActionErrorMessage({
      message: 'fallback',
      response: { data: { detail: 'backend detail' } },
    })).toBe('backend detail');
  });

  it('formats pydantic array details by location and message', () => {
    expect(getActionErrorMessage({
      message: 'fallback',
      response: {
        data: {
          detail: [
            { loc: ['body', 'qty'], msg: 'field required' },
            { loc: ['body', 'item_id'], msg: 'invalid integer' },
          ],
        },
      },
    })).toBe('body.qty: field required; body.item_id: invalid integer');
  });

  it('uses a validation fallback for object response details', () => {
    const message = getActionErrorMessage({
      message: 'fallback',
      response: { data: { detail: { qty: ['field required'] } } },
    });

    expect(message).not.toBe('fallback');
    expect(message).not.toContain('[object Object]');
    expect(message.length).toBeGreaterThan(0);
  });
});

describe('executeMaintenanceAction', () => {
  it('returns a validation error when no targets are selected', async () => {
    const context = createExecutionContext();

    const result = await executeMaintenanceAction({
      actionType: 'cleaning',
      selectedItems: [],
      fallbackInvNo: '',
      ...context,
    });

    expect(result).toEqual({ error: expect.any(String) });
    expect(result.error.length).toBeGreaterThan(0);
    expect(context.loadDetailedItemsByInvNos).not.toHaveBeenCalled();
    expect(context.equipmentAPI.consumeConsumable).not.toHaveBeenCalled();
  });

  it('rejects cartridge actions for non-printer targets before consuming stock', async () => {
    const context = createExecutionContext([createPc()]);

    const result = await executeMaintenanceAction({
      actionType: 'cartridge',
      selectedItems: ['PC-1'],
      selectedWorkConsumable: defaultConsumable,
      ...context,
    });

    expect(result.error).toContain('PC-1');
    expect(context.loadDetailedItemsByInvNos).not.toHaveBeenCalled();
    expect(context.equipmentAPI.consumeConsumable).not.toHaveBeenCalled();
    expect(context.jsonAPI.addCartridgeReplacement).not.toHaveBeenCalled();
  });

  it('requires a consumable before replacing a cartridge', async () => {
    const context = createExecutionContext([createPrinter()]);

    const result = await executeMaintenanceAction({
      actionType: 'cartridge',
      selectedItems: ['PRN-1'],
      selectedWorkConsumable: null,
      ...context,
    });

    expect(result).toEqual({ error: expect.any(String) });
    expect(result.error.length).toBeGreaterThan(0);
    expect(context.loadDetailedItemsByInvNos).not.toHaveBeenCalled();
    expect(context.equipmentAPI.consumeConsumable).not.toHaveBeenCalled();
    expect(context.jsonAPI.addCartridgeReplacement).not.toHaveBeenCalled();
  });

  it('consumes stock and records cartridge replacement history for a printer target', async () => {
    const printer = createPrinter();
    const context = createExecutionContext([printer]);

    const result = await executeMaintenanceAction({
      actionType: 'cartridge',
      selectedItems: ['PRN-1'],
      selectedWorkConsumable: defaultConsumable,
      cartridgeModel: 'fallback model',
      effectiveDbName: 'main-db',
      ...context,
    });

    expect(result).toEqual({ shouldRefreshEquipment: true });
    expect(context.loadDetailedItemsByInvNos).toHaveBeenCalledWith(['PRN-1']);
    expect(context.equipmentAPI.consumeConsumable).toHaveBeenCalledWith({
      item_id: 501,
      qty: 1,
      reason: 'cartridge',
    });
    expect(context.jsonAPI.addCartridgeReplacement).toHaveBeenCalledWith(expect.objectContaining({
      printer_model: 'HP LaserJet 400',
      cartridge_color: DEFAULT_CARTRIDGE_COLOR,
      component_type: 'cartridge',
      component_color: DEFAULT_CARTRIDGE_COLOR,
      cartridge_model: 'CE505A',
      detection_source: 'sql-consumables',
      serial_number: 'SN-PRN-1',
      employee: 'Ivan Petrov',
      branch: 'HQ',
      location: 'Room 101',
      inv_no: 'PRN-1',
      db_name: 'main-db',
      equipment_id: 101,
      current_description: 'Office printer',
      hw_serial_no: 'HW-PRN-1',
      model_name: 'HP LaserJet 400',
      manufacturer: 'HP',
      additional_data: {
        consumable_item_id: 501,
        consumable_inv_no: 'CRT-501',
        consumable_model: 'CE505A',
        consumable_branch: 'HQ',
        consumable_location: 'Storage',
      },
    }));
  });

  it('returns a component validation error for mixed target capabilities', async () => {
    const context = createExecutionContext([
      createPrinter(),
      createPc(),
    ]);

    const result = await executeMaintenanceAction({
      actionType: 'component',
      selectedItems: ['PRN-1', 'PC-1'],
      selectedWorkConsumable: { ...defaultConsumable, model_name: 'SSD 512GB' },
      componentType: 'ssd',
      ...context,
    });

    expect(result).toEqual({ error: expect.any(String) });
    expect(result.error.length).toBeGreaterThan(0);
    expect(context.loadDetailedItemsByInvNos).not.toHaveBeenCalled();
    expect(context.equipmentAPI.consumeConsumable).not.toHaveBeenCalled();
    expect(context.jsonAPI.addComponentReplacement).not.toHaveBeenCalled();
  });

  it('throws a clear component error when the consumable model is missing', async () => {
    const context = createExecutionContext([createPc()]);

    await expect(executeMaintenanceAction({
      actionType: 'component',
      selectedItems: ['PC-1'],
      selectedWorkConsumable: { ...defaultConsumable, model_name: '' },
      componentType: 'ssd',
      ...context,
    })).rejects.toThrow();

    expect(context.equipmentAPI.consumeConsumable).not.toHaveBeenCalled();
    expect(context.jsonAPI.addComponentReplacement).not.toHaveBeenCalled();
  });

  it('records a cleaning action for one PC target without consuming stock', async () => {
    const pc = createPc();
    const context = createExecutionContext([pc]);

    const result = await executeMaintenanceAction({
      actionType: 'cleaning',
      selectedItems: ['PC-1'],
      selectedWorkConsumable: null,
      effectiveDbName: 'main-db',
      ...context,
    });

    expect(result).toEqual({ shouldRefreshEquipment: false });
    expect(context.equipmentAPI.consumeConsumable).not.toHaveBeenCalled();
    expect(context.jsonAPI.addPcCleaning).toHaveBeenCalledWith(expect.objectContaining({
      serial_number: 'SN-PC-1',
      employee: 'Anna Sidorova',
      branch: 'HQ',
      location: 'Room 202',
      inv_no: 'PC-1',
      db_name: 'main-db',
      equipment_id: 201,
      current_description: 'Office workstation',
      hw_serial_no: 'HW-PC-1',
      model_name: 'Dell OptiPlex',
      manufacturer: 'Dell',
    }));
    expect(context.jsonAPI.addBatteryReplacement).not.toHaveBeenCalled();
    expect(context.jsonAPI.addCartridgeReplacement).not.toHaveBeenCalled();
  });
});
