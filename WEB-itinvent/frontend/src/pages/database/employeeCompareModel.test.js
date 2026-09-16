import { describe, expect, it } from 'vitest';

import {
  aggregateEmployeeBalances,
  buildCompareMaps,
  groupHubItemsByPartNo,
  isBalancesMetaIncomplete,
  isEmployeeCompareSummaryComplete,
  normalizeCompareKey,
  resolve1cRowStatus,
  resolveHubRowStatus,
  typeNameNeedles,
  ROW_MATCH_STATUS,
} from './employeeCompareModel';

const hubItem = (overrides = {}) => ({
  inv_no: 'INV-1',
  model_name: 'ThinkPad',
  serial_no: 'SN-1',
  part_no: 'БУ-001',
  ...overrides,
});

const balanceRow = (overrides = {}) => ({
  nomenclature_ref: 'ref-1',
  nomenclature_code: 'БУ-001',
  nomenclature_name: 'Ноутбук Lenovo',
  qty_balance: 1,
  ...overrides,
});

describe('normalizeCompareKey', () => {
  it('collapses whitespace and folds case', () => {
    expect(normalizeCompareKey('  БУ-001  ')).toBe('бу-001');
    expect(normalizeCompareKey('А  1')).toBe('а 1');
    expect(normalizeCompareKey(null)).toBe('');
  });
});

describe('aggregateEmployeeBalances', () => {
  it('sums series/batch rows into one bucket per code', () => {
    const { byCode, unjoinable } = aggregateEmployeeBalances([
      balanceRow({ qty_balance: 1, series_name: 'S1' }),
      balanceRow({ qty_balance: 2, series_name: 'S2' }),
      balanceRow({ nomenclature_code: 'БУ-002', nomenclature_name: 'Мышь', qty_balance: 4 }),
    ]);

    expect(byCode.get(normalizeCompareKey('БУ-001')).qty1c).toBe(3);
    expect(byCode.get(normalizeCompareKey('БУ-001')).details).toHaveLength(2);
    expect(byCode.get(normalizeCompareKey('БУ-002')).qty1c).toBe(4);
    expect(unjoinable).toHaveLength(0);
  });

  it('keeps rows without code as unjoinable', () => {
    const { unjoinable } = aggregateEmployeeBalances([
      balanceRow({ nomenclature_code: '', qty_balance: 2 }),
    ]);
    expect(unjoinable).toHaveLength(1);
    expect(unjoinable[0].qty1c).toBe(2);
  });
});

describe('groupHubItemsByPartNo', () => {
  it('splits usable, sentinel and pending part numbers', () => {
    const { byPartNo, noPartNoItems, notIn1cItems } = groupHubItemsByPartNo([
      hubItem({ inv_no: 'A', part_no: 'БУ-001' }),
      hubItem({ inv_no: 'B', part_no: ' бу-001 ' }),
      hubItem({ inv_no: 'C', part_no: 'нет в 1С' }),
      hubItem({ inv_no: 'D', part_no: '' }),
      hubItem({ inv_no: 'E', part_no: 'не найден' }),
    ]);

    expect(byPartNo.get(normalizeCompareKey('БУ-001')).items).toHaveLength(2);
    expect(notIn1cItems.map((i) => i.inv_no)).toEqual(['C']);
    expect(noPartNoItems.map((i) => i.inv_no)).toEqual(['D', 'E']);
  });
});

describe('buildCompareMaps', () => {
  it('exposes per-key quantities on both sides', () => {
    const { qty1cByCode, countByPartNo } = buildCompareMaps({
      hubItems: [
        hubItem({ part_no: 'БУ-001' }),
        hubItem({ inv_no: 'INV-2', part_no: 'нет в 1С' }),
        hubItem({ inv_no: 'INV-3', part_no: '' }),
      ],
      balances: [
        balanceRow({ nomenclature_code: 'БУ-001' }),
        balanceRow({ nomenclature_code: 'БУ-002', qty_balance: 3 }),
        balanceRow({ nomenclature_code: '', nomenclature_name: 'Без кода' }),
      ],
    });

    expect(countByPartNo.get(normalizeCompareKey('БУ-001'))).toBe(1);
    expect(countByPartNo.size).toBe(1);
    expect(qty1cByCode.get(normalizeCompareKey('БУ-001'))).toBe(1);
    expect(qty1cByCode.get(normalizeCompareKey('БУ-002'))).toBe(3);
    expect(qty1cByCode.size).toBe(2);
  });
});

describe('row match statuses', () => {
  const maps = buildCompareMaps({
    hubItems: [
      hubItem({ inv_no: 'A', part_no: 'БУ-001' }),
      hubItem({ inv_no: 'B', part_no: 'БУ-002' }),
      hubItem({ inv_no: 'C', part_no: 'БУ-777' }),
    ],
    balances: [
      balanceRow({ nomenclature_code: 'БУ-001', qty_balance: 1 }),
      balanceRow({ nomenclature_code: 'БУ-002', qty_balance: 5 }),
      balanceRow({ nomenclature_code: 'БУ-900' }),
    ],
  });

  it('resolves hub-side statuses', () => {
    expect(resolveHubRowStatus('БУ-001', maps)).toBe(ROW_MATCH_STATUS.MATCH);
    expect(resolveHubRowStatus('БУ-002', maps)).toBe(ROW_MATCH_STATUS.DIFF);
    expect(resolveHubRowStatus('БУ-777', maps)).toBe(ROW_MATCH_STATUS.ONLY_HUB);
    expect(resolveHubRowStatus('', maps)).toBeNull();
    expect(resolveHubRowStatus('нет в 1С', maps)).toBeNull();
  });

  it('resolves 1C-side statuses', () => {
    expect(resolve1cRowStatus('БУ-001', maps)).toBe(ROW_MATCH_STATUS.MATCH);
    expect(resolve1cRowStatus('БУ-002', maps)).toBe(ROW_MATCH_STATUS.DIFF);
    expect(resolve1cRowStatus('БУ-900', maps)).toBe(ROW_MATCH_STATUS.ONLY_1C);
    expect(resolve1cRowStatus('', maps)).toBeNull();
  });
});

describe('isBalancesMetaIncomplete', () => {
  it('treats ok meta as complete', () => {
    expect(isBalancesMetaIncomplete({ status: 'ok', has_more: false, truncated: false })).toBe(false);
  });

  it('flags missing meta and non-ok statuses', () => {
    expect(isBalancesMetaIncomplete(null)).toBe(true);
    expect(isBalancesMetaIncomplete({ status: 'incomplete' })).toBe(true);
    expect(isBalancesMetaIncomplete({ status: 'ok', has_more: true })).toBe(true);
    expect(isBalancesMetaIncomplete({ status: 'ok', truncated: true })).toBe(true);
  });
});

describe('isEmployeeCompareSummaryComplete', () => {
  it('is true only for a complete ok summary', () => {
    expect(isEmployeeCompareSummaryComplete({ status: 'ok' })).toBe(true);
    expect(isEmployeeCompareSummaryComplete({ status: 'ok', truncated: false, has_more: false })).toBe(true);
  });

  it('is false for missing, unknown or incomplete snapshots', () => {
    expect(isEmployeeCompareSummaryComplete(null)).toBe(false);
    expect(isEmployeeCompareSummaryComplete({ status: 'unknown' })).toBe(false);
    expect(isEmployeeCompareSummaryComplete({ status: 'incomplete' })).toBe(false);
    expect(isEmployeeCompareSummaryComplete({ status: 'ok', truncated: true })).toBe(false);
    expect(isEmployeeCompareSummaryComplete({ status: 'ok', has_more: true })).toBe(false);
    expect(isEmployeeCompareSummaryComplete({ status: 'ok', hasMore: true })).toBe(false);
  });
});

describe('typeNameNeedles', () => {
  it('always includes the type name itself', () => {
    expect(typeNameNeedles('Сканер')).toEqual(['сканер']);
    expect(typeNameNeedles('')).toEqual([]);
  });

  it('adds synonyms for system unit', () => {
    const needles = typeNameNeedles('Системный блок');
    expect(needles).toContain('системный блок');
    expect(needles).toContain('компьютер');
    expect(needles).toContain('пк');
  });

  it('matches variant type names containing a known alias key', () => {
    expect(typeNameNeedles('Системный блок ATX')).toContain('компьютер');
    expect(typeNameNeedles('Монитор 24"')).toContain('дисплей');
    expect(typeNameNeedles('МФУ')).toContain('принтер');
  });
});
