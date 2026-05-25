import { describe, expect, it } from 'vitest';

import {
  DATA_MODE_CONSUMABLES,
  DEFAULT_CARTRIDGE_COLOR,
  getComponentLabel,
  getEquipmentRowActions,
  getItemCapabilityFlags,
  normalizePrinterComponentType,
  removeItemFromGrouped,
  toInvNo,
  upsertItemInGrouped,
} from './equipmentModel';

describe('equipmentModel', () => {
  it('normalizes inventory numbers from raw values and equipment rows', () => {
    expect(toInvNo(' 1001 ')).toBe('1001');
    expect(toInvNo({ INV_NO: '2002' })).toBe('2002');
    expect(toInvNo({ inv_no: '3003' })).toBe('3003');
    expect(toInvNo({ MODEL_NAME: 'No inventory' })).toBe('');
  });

  it('derives equipment capabilities from type, model and vendor fields', () => {
    expect(getItemCapabilityFlags({ TYPE_NAME: 'Printer', MODEL_NAME: 'LaserJet' })).toEqual({
      isPrinterOrMfu: true,
      isUps: false,
      isPc: false,
    });

    expect(getItemCapabilityFlags({ TYPE_NAME: 'UPS APC' })).toEqual({
      isPrinterOrMfu: false,
      isUps: true,
      isPc: false,
    });

    expect(getItemCapabilityFlags({ TYPE_NAME: 'PC', MODEL_NAME: 'Office workstation' })).toEqual({
      isPrinterOrMfu: false,
      isUps: false,
      isPc: true,
    });
  });

  it('builds allowed row actions from capabilities and permissions', () => {
    expect(getEquipmentRowActions({
      item: { TYPE_NAME: 'Printer' },
      canWrite: true,
      isAdmin: true,
    })).toEqual(['view', 'location_transfer', 'transfer', 'cartridge', 'component', 'delete']);

    expect(getEquipmentRowActions({
      item: { TYPE_NAME: 'UPS' },
      canWrite: true,
      isAdmin: false,
    })).toEqual(['view', 'location_transfer', 'transfer', 'battery']);

    expect(getEquipmentRowActions({
      item: { TYPE_NAME: 'PC' },
      dataMode: DATA_MODE_CONSUMABLES,
      canWrite: true,
      isAdmin: true,
    })).toEqual([]);
  });

  it('keeps component defaults and labels stable', () => {
    expect(DEFAULT_CARTRIDGE_COLOR).toBe('Универсальный');
    expect(normalizePrinterComponentType('drum')).toBe('photoconductor');
    expect(getComponentLabel('printer', 'photoconductor')).toBe('Фотобарабан');
    expect(getComponentLabel('pc', 'ssd')).toBe('SSD накопитель');
  });

  it('upserts equipment rows and prunes empty grouped branches', () => {
    const grouped = {
      BranchA: {
        Location1: [
          { INV_NO: '1001', MODEL_NAME: 'Old' },
        ],
      },
      BranchB: {
        Location2: [
          { INV_NO: '2001', MODEL_NAME: 'Keep' },
        ],
      },
    };

    expect(upsertItemInGrouped(grouped, {
      INV_NO: '1001',
      MODEL_NAME: 'Moved',
      BRANCH_NAME: 'BranchC',
      LOCATION_NAME: 'Location3',
    })).toEqual({
      BranchB: {
        Location2: [
          { INV_NO: '2001', MODEL_NAME: 'Keep' },
        ],
      },
      BranchC: {
        Location3: [
          {
            INV_NO: '1001',
            MODEL_NAME: 'Moved',
            BRANCH_NAME: 'BranchC',
            LOCATION_NAME: 'Location3',
          },
        ],
      },
    });

    expect(removeItemFromGrouped(grouped, '2001')).toEqual({
      BranchA: {
        Location1: [
          { INV_NO: '1001', MODEL_NAME: 'Old' },
        ],
      },
    });
  });
});
