import { describe, expect, it, vi } from 'vitest';

import {
  buildDatabaseSearchIndex,
  buildEquipmentIndex,
  buildLocationKey,
  buildSearchResultState,
  buildVisibleInvNoSet,
  countSelectedVisible,
  countGroupedItems,
  filterGroupedByBranch,
  getSelectedItemsCapabilities,
  getVisibleBranchNames,
  getVisibleLocationKeys,
  hasExpandedVisible,
  groupSearchResults,
  mergeGroupedEquipment,
  normalizeActionTargets,
  runInBatches,
} from './databaseListModel';

describe('databaseListModel', () => {
  it('counts grouped equipment rows across branches and locations', () => {
    expect(countGroupedItems({
      HQ: { Office: [{ INV_NO: '1' }, { INV_NO: '2' }] },
      Remote: { Stock: [{ INV_NO: '3' }], Empty: [] },
    })).toBe(3);
    expect(countGroupedItems(null)).toBe(0);
  });

  it('groups flat search matches by branch and location', () => {
    expect(groupSearchResults([
      { branchName: 'HQ', locationName: 'Office', item: { INV_NO: '1' } },
      { branchName: 'HQ', locationName: 'Office', item: { INV_NO: '2' } },
      { branchName: 'Remote', locationName: 'Stock', item: { INV_NO: '3' } },
    ])).toEqual({
      HQ: { Office: [{ INV_NO: '1' }, { INV_NO: '2' }] },
      Remote: { Stock: [{ INV_NO: '3' }] },
    });
  });

  it('filters grouped equipment by normalized branch name', () => {
    const grouped = {
      HQ: { Office: [{ INV_NO: '1' }] },
      Remote: { Stock: [{ INV_NO: '2' }] },
    };

    expect(filterGroupedByBranch(grouped, ' hq ')).toEqual({
      HQ: { Office: [{ INV_NO: '1' }] },
    });
    expect(filterGroupedByBranch(grouped, '')).toBe(grouped);
    expect(filterGroupedByBranch(null, '')).toEqual({});
    expect(filterGroupedByBranch(grouped, 'missing')).toEqual({});
  });

  it('builds a database search index and grouped expanded result state', () => {
    const printer = {
      ID: 7,
      INV_NO: 'INV-1',
      SERIAL_NO: 'SER-1',
      HW_SERIAL_NO: 'HW-1',
      MODEL_NAME: 'LaserJet 400',
      TYPE_NAME: 'Printer',
      OWNER_DISPLAY_NAME: 'Ivan Petrov',
      IP_ADDRESS: '10.0.0.5',
      MAC_ADDRESS: 'AA:BB-CC 11',
      NETBIOS_NAME: 'WS-01',
      DOMAIN_NAME: 'corp.local',
    };
    const pc = {
      id: 8,
      inv_no: 'INV-2',
      serial_no: 'SER-2',
      hw_serial_no: 'HW-2',
      model_name: 'ThinkCentre',
      type_name: 'PC',
      employee_name: 'Anna Sidorova',
      ip_address: '10.0.0.6',
      mac_addr: 'DD:EE:FF',
      network_name: 'PC-02',
      domain_name: 'lab.local',
    };
    const index = buildDatabaseSearchIndex({
      HQ: { Office: [printer] },
      Remote: { Stock: [pc] },
    });

    expect(index).toHaveLength(2);
    expect(index[0]).toMatchObject({ branchName: 'HQ', locationName: 'Office', item: printer });
    expect(index[0].searchable).toBe(index[0].searchable.toLowerCase());
    expect(index[0].searchable).toContain('7');
    expect(index[0].searchable).toContain('inv-1');
    expect(index[0].searchable).toContain('ser-1');
    expect(index[0].searchable).toContain('hw-1');
    expect(index[0].searchable).toContain('laserjet 400');
    expect(index[0].searchable).toContain('printer');
    expect(index[0].searchable).toContain('ivan petrov');
    expect(index[0].searchable).toContain('10.0.0.5');
    expect(index[0].searchable).toContain('aa:bb-cc 11');
    expect(index[0].searchable).toContain('aabbcc11');
    expect(index[0].searchable).toContain('ws-01');
    expect(index[0].searchable).toContain('corp.local');
    expect(index[1].searchable).toContain('pc-02');

    expect(buildSearchResultState(index, ' i ')).toEqual({
      filteredData: null,
      expandedBranches: null,
      expandedLocations: null,
    });

    const matched = buildSearchResultState(index, 'aabbcc11');
    expect(matched.filteredData).toEqual({ HQ: { Office: [printer] } });
    expect(matched.expandedBranches).toEqual(new Set(['HQ']));
    expect(matched.expandedLocations).toEqual(new Set(['HQ::Office']));

    expect(buildSearchResultState(index, 'not-found')).toEqual({
      filteredData: {},
      expandedBranches: new Set(),
      expandedLocations: new Set(),
    });
  });

  it('normalizes action targets and location keys', () => {
    expect(normalizeActionTargets([' 1001 ', '', null, '1002'], 'fallback')).toEqual(['1001', '1002']);
    expect(normalizeActionTargets([], ' 1003 ')).toEqual(['1003']);
    expect(buildLocationKey('HQ', 'Office')).toBe('HQ::Office');
  });

  it('builds equipment indexes, visible location keys, expansion state, and visible selection counts', () => {
    const hqItem = { INV_NO: '1001' };
    const remoteItem = { inv_no: '1002' };
    const numericItem = { INV_NO: 1003 };
    const grouped = {
      HQ: { Office: [hqItem] },
      Remote: { Stock: [remoteItem], Lab: [numericItem] },
    };

    const equipmentIndex = buildEquipmentIndex(grouped);
    expect(equipmentIndex.get('1001')).toBe(hqItem);
    expect(equipmentIndex.get('1002')).toBe(remoteItem);
    expect(equipmentIndex.get('1003')).toBe(numericItem);
    expect(equipmentIndex.has('')).toBe(false);

    const branchNames = getVisibleBranchNames(grouped);
    const locationKeys = getVisibleLocationKeys(grouped, branchNames);
    expect(branchNames).toEqual(['HQ', 'Remote']);
    expect(locationKeys).toEqual(['HQ::Office', 'Remote::Stock', 'Remote::Lab']);
    expect(hasExpandedVisible({
      branchNames,
      locationKeys,
      expandedBranches: new Set(['Missing']),
      expandedLocations: new Set(['Remote::Stock']),
    })).toBe(true);
    expect(hasExpandedVisible({
      branchNames,
      locationKeys,
      expandedBranches: new Set(['HQ']),
      expandedLocations: new Set(),
    })).toBe(true);
    expect(hasExpandedVisible({
      branchNames,
      locationKeys,
      expandedBranches: new Set(['Missing']),
      expandedLocations: new Set(['Missing::Location']),
    })).toBe(false);

    const visibleInvNoSet = buildVisibleInvNoSet(grouped);
    expect(visibleInvNoSet).toEqual(new Set(['1001', '1002', '1003']));
    expect(countSelectedVisible(['1002', 'missing', 1003], visibleInvNoSet)).toBe(2);
  });

  it('derives selected item capabilities for unresolved, mixed, printer, pc, and ups selections', () => {
    const emptyCapabilities = {
      canCartridge: false,
      canBattery: false,
      canComponent: false,
      componentKind: null,
      canCleaning: false,
    };
    const items = new Map([
      ['printer-1', { INV_NO: 'printer-1', TYPE_NAME: 'Printer', MODEL_NAME: 'LaserJet' }],
      ['printer-2', { INV_NO: 'printer-2', TYPE_NAME: 'MFP', MODEL_NAME: 'WorkCentre' }],
      ['pc-1', { INV_NO: 'pc-1', TYPE_NAME: 'PC', MODEL_NAME: 'Office workstation' }],
      ['pc-2', { INV_NO: 'pc-2', TYPE_NAME: 'system unit', MODEL_NAME: 'ThinkCentre' }],
      ['ups-1', { INV_NO: 'ups-1', TYPE_NAME: 'UPS APC' }],
    ]);
    const findEquipmentByInvNo = (invNo) => items.get(invNo) || null;

    expect(getSelectedItemsCapabilities([], findEquipmentByInvNo)).toEqual(emptyCapabilities);
    expect(getSelectedItemsCapabilities(['missing'], findEquipmentByInvNo)).toEqual(emptyCapabilities);
    expect(getSelectedItemsCapabilities(['printer-1', 'missing'], findEquipmentByInvNo)).toEqual(emptyCapabilities);
    expect(getSelectedItemsCapabilities(['printer-1', 'pc-1'], findEquipmentByInvNo)).toEqual(emptyCapabilities);
    expect(getSelectedItemsCapabilities(['printer-1', 'printer-2'], findEquipmentByInvNo)).toEqual({
      canCartridge: true,
      canBattery: false,
      canComponent: true,
      componentKind: 'printer',
      canCleaning: false,
    });
    expect(getSelectedItemsCapabilities(['pc-1', 'pc-2'], findEquipmentByInvNo)).toEqual({
      canCartridge: false,
      canBattery: false,
      canComponent: true,
      componentKind: 'pc',
      canCleaning: true,
    });
    expect(getSelectedItemsCapabilities(['ups-1'], findEquipmentByInvNo)).toEqual({
      canCartridge: false,
      canBattery: true,
      canComponent: false,
      componentKind: null,
      canCleaning: false,
    });
  });

  it('merges grouped equipment without duplicating existing inventory numbers', () => {
    expect(mergeGroupedEquipment(
      { HQ: { Office: [{ INV_NO: '1' }, { INV_NO: '2' }] } },
      { HQ: { Office: [{ INV_NO: '2', MODEL_NAME: 'Duplicate' }, { INV_NO: '3' }] }, Remote: { Stock: [{ inv_no: '4' }] } }
    )).toEqual({
      HQ: { Office: [{ INV_NO: '1' }, { INV_NO: '2' }, { INV_NO: '3' }] },
      Remote: { Stock: [{ inv_no: '4' }] },
    });
  });

  it('runs async workers in bounded batches and preserves settled results order', async () => {
    const worker = vi.fn(async (value) => {
      if (value === 3) throw new Error('bad value');
      return value * 2;
    });

    const settled = await runInBatches([1, 2, 3, 4], worker, 2);

    expect(worker).toHaveBeenCalledTimes(4);
    expect(settled.map((entry) => entry.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled']);
    expect(settled[0].value).toBe(2);
    expect(settled[3].value).toBe(8);
  });
});
