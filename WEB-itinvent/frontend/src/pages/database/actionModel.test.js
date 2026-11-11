import { describe, expect, it, vi } from 'vitest';

import {
  filterActionWorkConsumableOptions,
  getActiveComponentOptions,
  resolveSingleActionTarget,
  shouldLoadWorkConsumables,
} from './actionModel';
import {
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
} from './equipmentModel';

const cartridgeConsumable = {
  id: 1,
  type_name: 'Cartridge',
  model_name: 'HP 12A',
};

const tonerConsumable = {
  id: 2,
  type_name: 'Supply',
  model_name: 'Black toner',
};

const componentConsumable = {
  id: 3,
  type_name: 'Fuser',
  model_name: 'RM2-1256',
};

describe('actionModel', () => {
  describe('resolveSingleActionTarget', () => {
    it('marks multi-selection without resolving an item', () => {
      const findEquipmentByInvNo = vi.fn();

      expect(resolveSingleActionTarget({
        selectedItems: ['1001', '1002'],
        fallbackInvNo: '1003',
        findEquipmentByInvNo,
      })).toEqual({ multiple: true, item: null });
      expect(findEquipmentByInvNo).not.toHaveBeenCalled();
    });

    it('resolves the selected inventory number before fallback', () => {
      const selectedItem = { INV_NO: '1001' };
      const fallbackItem = { INV_NO: '1002' };
      const findEquipmentByInvNo = vi.fn((invNo) => (
        invNo === '1001' ? selectedItem : fallbackItem
      ));

      expect(resolveSingleActionTarget({
        selectedItems: [' 1001 '],
        fallbackInvNo: '1002',
        findEquipmentByInvNo,
      })).toEqual({ multiple: false, item: selectedItem });
      expect(findEquipmentByInvNo).toHaveBeenCalledWith('1001');
    });

    it('uses fallback inventory number when nothing is selected', () => {
      const item = { INV_NO: '2001' };
      const findEquipmentByInvNo = vi.fn(() => item);

      expect(resolveSingleActionTarget({
        selectedItems: [],
        fallbackInvNo: '2001',
        findEquipmentByInvNo,
      })).toEqual({ multiple: false, item });
    });

    it('returns null item for missing target, missing resolver, or unresolved inventory number', () => {
      expect(resolveSingleActionTarget({
        selectedItems: [],
        fallbackInvNo: '   ',
        findEquipmentByInvNo: vi.fn(),
      })).toEqual({ multiple: false, item: null });

      expect(resolveSingleActionTarget({
        selectedItems: ['3001'],
      })).toEqual({ multiple: false, item: null });

      expect(resolveSingleActionTarget({
        selectedItems: ['3002'],
        findEquipmentByInvNo: () => undefined,
      })).toEqual({ multiple: false, item: null });
    });
  });

  it('returns PC component options only for pc kind', () => {
    expect(getActiveComponentOptions('pc')).toBe(PC_COMPONENT_OPTIONS);
    expect(getActiveComponentOptions('printer')).toBe(PRINTER_COMPONENT_OPTIONS);
    expect(getActiveComponentOptions(null)).toBe(PRINTER_COMPONENT_OPTIONS);
  });

  describe('filterActionWorkConsumableOptions', () => {
    it('keeps only cartridge-like consumables for cartridge actions', () => {
      expect(filterActionWorkConsumableOptions({
        options: [cartridgeConsumable, tonerConsumable, componentConsumable],
        actionType: 'cartridge',
        componentKind: null,
      })).toEqual([cartridgeConsumable, tonerConsumable]);
    });

    it('hides cartridge-like consumables for printer component actions', () => {
      expect(filterActionWorkConsumableOptions({
        options: [cartridgeConsumable, componentConsumable],
        actionType: 'component',
        componentKind: 'printer',
      })).toEqual([componentConsumable]);
    });

    it('returns the source array for non-printer component and other actions', () => {
      const options = [cartridgeConsumable, componentConsumable];

      expect(filterActionWorkConsumableOptions({
        options,
        actionType: 'component',
        componentKind: 'pc',
      })).toBe(options);

      expect(filterActionWorkConsumableOptions({
        options,
        actionType: 'battery',
        componentKind: null,
      })).toBe(options);
    });

    it('normalizes non-array options to an empty array', () => {
      expect(filterActionWorkConsumableOptions({
        options: null,
        actionType: 'battery',
        componentKind: null,
      })).toEqual([]);
    });
  });

  it('detects when work consumables should be loaded', () => {
    expect(shouldLoadWorkConsumables({ open: false, type: 'cartridge' })).toBe(false);
    expect(shouldLoadWorkConsumables({ open: true, type: 'cartridge' })).toBe(true);
    expect(shouldLoadWorkConsumables({ open: true, type: 'component', componentKind: 'pc' })).toBe(true);
    expect(shouldLoadWorkConsumables({ open: true, type: 'component', componentKind: null })).toBe(false);
    expect(shouldLoadWorkConsumables({ open: true, type: 'battery', componentKind: 'printer' })).toBe(false);
  });
});
