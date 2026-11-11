import { describe, expect, it } from 'vitest';

import {
  EMPLOYEE_COMPARE_MAX_AGE_MS,
  aggregateEmployeeBalances,
  areBalanceQuantitiesValid,
  buildCompareMaps,
  buildEmployeeCompareSummary,
  groupHubItemsByPartNo,
  isBalancesMetaIncomplete,
  isEmployeeCompareSnapshotFresh,
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

  it('flags missing meta, empty meta and non-ok statuses', () => {
    expect(isBalancesMetaIncomplete(null)).toBe(true);
    expect(isBalancesMetaIncomplete({})).toBe(true);
    expect(isBalancesMetaIncomplete({ status: '' })).toBe(true);
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
    expect(isEmployeeCompareSummaryComplete({ status: 'ok', balances_status: 'unknown' })).toBe(false);
    expect(isEmployeeCompareSummaryComplete({ status: 'ok', balances_truncated: true })).toBe(false);
    expect(isEmployeeCompareSummaryComplete({ status: 'ok', catalog_truncated: true })).toBe(false);
    expect(isEmployeeCompareSummaryComplete({ status: 'ok', balances_status: 'ok' })).toBe(true);
  });
});

describe('isEmployeeCompareSnapshotFresh', () => {
  const now = Date.parse('2026-05-27T12:00:00.000Z');

  it('accepts a recent parseable timestamp', () => {
    expect(isEmployeeCompareSnapshotFresh('2026-05-27T11:59:30.000Z', now)).toBe(true);
    expect(isEmployeeCompareSnapshotFresh('2026-05-27T11:45:00.000Z', now)).toBe(true);
    expect(isEmployeeCompareSnapshotFresh(now - EMPLOYEE_COMPARE_MAX_AGE_MS + 1, now)).toBe(true);
  });

  it('rejects missing, malformed, stale or future timestamps', () => {
    expect(isEmployeeCompareSnapshotFresh(null, now)).toBe(false);
    expect(isEmployeeCompareSnapshotFresh(undefined, now)).toBe(false);
    expect(isEmployeeCompareSnapshotFresh('', now)).toBe(false);
    expect(isEmployeeCompareSnapshotFresh('not-a-date', now)).toBe(false);
    expect(isEmployeeCompareSnapshotFresh('2026-05-27T11:20:00.000Z', now)).toBe(false);
    expect(isEmployeeCompareSnapshotFresh(now - EMPLOYEE_COMPARE_MAX_AGE_MS, now)).toBe(false);
    expect(isEmployeeCompareSnapshotFresh('2026-05-27T12:00:01.000Z', now)).toBe(false);
    expect(isEmployeeCompareSnapshotFresh(now + 1, now)).toBe(false);
  });
});

describe('areBalanceQuantitiesValid', () => {
  it('requires every row to carry a finite non-negative qty_balance', () => {
    expect(areBalanceQuantitiesValid([
      { nomenclature_code: 'a', qty_balance: 0 },
      { nomenclature_code: 'b', qty_balance: '2.5' },
    ])).toBe(true);
    expect(areBalanceQuantitiesValid([])).toBe(true);
    expect(areBalanceQuantitiesValid(null)).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: '' }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: '  ' }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: null }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: 'abc' }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: NaN }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: Infinity }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: -1 }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: true }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: false }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: [2] }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: { value: 2 } }])).toBe(false);
    expect(areBalanceQuantitiesValid([{ qty_balance: '2' }])).toBe(true);
  });
});

describe('buildEmployeeCompareSummary', () => {
  const baseArgs = {
    ownerNo: 42,
    employeeName: 'Иванов И.И.',
    warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
    asOf: '2026-05-27T12:00:00.000Z',
  };

  it('marks a 2-vs-1 quantity split as diff with per-part evidence', () => {
    const summary = buildEmployeeCompareSummary({
      ...baseArgs,
      hubItems: [
        hubItem({ inv_no: '100021', part_no: 'ЦБ-00195776' }),
        hubItem({ inv_no: '100022', part_no: 'ЦБ-00195776' }),
      ],
      balances: [
        balanceRow({ nomenclature_code: 'ЦБ-00195776', qty_balance: 1 }),
      ],
    });

    const key = normalizeCompareKey('ЦБ-00195776');
    expect(summary.owner_no).toBe(42);
    expect(summary.employee_name).toBe('Иванов И.И.');
    expect(summary.warehouse_ref).toBe('wh-1');
    expect(summary.as_of).toBe('2026-05-27T12:00:00.000Z');
    expect(summary.status).toBe('diff');
    expect(summary.part_status[key]).toBe('diff');
    expect(summary.part_quantities[key]).toEqual({ hub_count: 2, qty_1c: 1 });
    expect(summary.counts).toEqual({
      match: 0, diff: 1, only_hub: 0, only_1c: 0,
      no_part: 0, not_in_1c: 0, hub_items: 2,
    });
  });

  it('sums series rows, counts codes and reports only-1C positions', () => {
    const summary = buildEmployeeCompareSummary({
      ...baseArgs,
      hubItems: [
        hubItem({ inv_no: 'A', part_no: 'PN-1' }),
        hubItem({ inv_no: 'B', part_no: 'PN-2' }),
      ],
      balances: [
        balanceRow({ nomenclature_code: 'pn-1', qty_balance: 0.5 }),
        balanceRow({ nomenclature_code: 'PN-1', qty_balance: 0.5 }),
        balanceRow({ nomenclature_code: 'PN-9', qty_balance: 3 }),
      ],
    });

    expect(summary.part_status[normalizeCompareKey('PN-1')]).toBe('match');
    expect(summary.part_status[normalizeCompareKey('PN-2')]).toBe('only_hub');
    expect(summary.part_quantities[normalizeCompareKey('PN-1')]).toEqual({ hub_count: 1, qty_1c: 1 });
    expect(summary.part_quantities[normalizeCompareKey('PN-2')]).toEqual({ hub_count: 1, qty_1c: null });
    expect(summary.counts.match).toBe(1);
    expect(summary.counts.only_hub).toBe(1);
    expect(summary.counts.only_1c).toBe(1);
    expect(summary.status).toBe('only_hub');
  });

  it('reports unknown when no usable Hub codes remain but unlinked items exist', () => {
    const summary = buildEmployeeCompareSummary({
      ...baseArgs,
      hubItems: [
        hubItem({ inv_no: 'A', part_no: '' }),
        hubItem({ inv_no: 'B', part_no: 'нет в 1С' }),
      ],
      balances: [],
    });

    expect(summary.status).toBe('unknown');
    expect(summary.counts.no_part).toBe(1);
    expect(summary.counts.not_in_1c).toBe(1);
    expect(summary.counts.hub_items).toBe(2);
    expect(summary.part_status).toEqual({});
    expect(summary.part_quantities).toEqual({});
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
