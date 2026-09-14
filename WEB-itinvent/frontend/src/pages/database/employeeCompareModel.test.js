import { describe, expect, it } from 'vitest';

import {
  aggregateEmployeeBalances,
  buildEmployeeCompare,
  EMPLOYEE_COMPARE_STATUS,
  filterEmployeeCompareRows,
  groupHubItemsByPartNo,
  isBalancesMetaIncomplete,
  normalizeCompareKey,
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

describe('buildEmployeeCompare', () => {
  it('joins balances and hub items by part number', () => {
    const { rows, summary } = buildEmployeeCompare({
      hubItems: [
        hubItem({ inv_no: 'H1', part_no: 'БУ-001' }),
        hubItem({ inv_no: 'H2', part_no: 'БУ-001' }),
        hubItem({ inv_no: 'H3', part_no: 'БУ-777', model_name: 'Сканер' }),
        hubItem({ inv_no: 'H4', part_no: '' }),
        hubItem({ inv_no: 'H5', part_no: 'БУ-003', model_name: 'Клавиатура' }),
      ],
      balances: [
        balanceRow({ qty_balance: 2 }),
        balanceRow({ nomenclature_code: 'БУ-002', nomenclature_name: 'Мышь', qty_balance: 1 }),
        balanceRow({ nomenclature_code: 'БУ-003', nomenclature_name: 'Клавиатура', qty_balance: 3 }),
      ],
    });

    const byCode = Object.fromEntries(rows.map((row) => [row.code, row]));

    expect(byCode['БУ-001'].status).toBe(EMPLOYEE_COMPARE_STATUS.MATCH);
    expect(byCode['БУ-001'].hubCount).toBe(2);
    expect(byCode['БУ-002'].status).toBe(EMPLOYEE_COMPARE_STATUS.ONLY_1C);
    expect(byCode['БУ-003'].status).toBe(EMPLOYEE_COMPARE_STATUS.DIFF);
    expect(byCode['БУ-003'].hubCount).toBe(1);
    expect(byCode['БУ-003'].delta).toBe(2);
    expect(byCode['БУ-777'].status).toBe(EMPLOYEE_COMPARE_STATUS.ONLY_HUB);
    expect(byCode['БУ-777'].name).toBe('Сканер');

    expect(summary).toMatchObject({
      match: 1,
      diff: 1,
      only1c: 1,
      onlyHub: 1,
      noPartNo: 1,
    });
  });

  it('marks everything hub-side as only_hub when balances are empty', () => {
    const { rows, summary } = buildEmployeeCompare({
      hubItems: [hubItem({ part_no: 'БУ-001' })],
      balances: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(EMPLOYEE_COMPARE_STATUS.ONLY_HUB);
    expect(summary.onlyHub).toBe(1);
  });

  it('orders mismatching rows before matched ones', () => {
    const { rows } = buildEmployeeCompare({
      hubItems: [hubItem({ part_no: 'БУ-001' })],
      balances: [
        balanceRow({ qty_balance: 1 }),
        balanceRow({ nomenclature_code: 'БУ-002', qty_balance: 5 }),
      ],
    });
    expect(rows[0].status).toBe(EMPLOYEE_COMPARE_STATUS.ONLY_1C);
    expect(rows[1].status).toBe(EMPLOYEE_COMPARE_STATUS.MATCH);
  });
});

describe('filterEmployeeCompareRows', () => {
  it('matches by code, name and hub inventory number', () => {
    const { rows } = buildEmployeeCompare({
      hubItems: [hubItem({ inv_no: 'INV-42', part_no: 'БУ-001' })],
      balances: [balanceRow({ nomenclature_name: 'Ноутбук Lenovo' })],
    });

    expect(filterEmployeeCompareRows(rows, 'бу-001')).toHaveLength(1);
    expect(filterEmployeeCompareRows(rows, 'lenovo')).toHaveLength(1);
    expect(filterEmployeeCompareRows(rows, 'inv-42')).toHaveLength(1);
    expect(filterEmployeeCompareRows(rows, 'другое')).toHaveLength(0);
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
