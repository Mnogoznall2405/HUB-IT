import { describe, expect, it } from 'vitest';

import {
  compareRuText,
  filterBalancesByText,
  resolveHubBalanceMatch,
  sortBalancesByNomenclature,
  sortBalancesByWarehouse,
  summarizeHubBalanceMatches,
  UNBOUNDED_MOVEMENT_PERIOD,
} from './warehouse1cShared';

describe('warehouse1cShared sorting/filter', () => {
  it('does not hide older movements behind a default period', () => {
    expect(UNBOUNDED_MOVEMENT_PERIOD).toEqual({
      dateFrom: '',
      dateTo: '',
    });
  });

  it('sorts nomenclature alphabetically in Russian', () => {
    const sorted = sortBalancesByNomenclature([
      { nomenclature_name: 'Кабель', nomenclature_code: '2' },
      { nomenclature_name: 'Адаптер', nomenclature_code: '1' },
      { nomenclature_name: 'Монитор', nomenclature_code: '3' },
    ]);
    expect(sorted.map((row) => row.nomenclature_name)).toEqual([
      'Адаптер',
      'Кабель',
      'Монитор',
    ]);
  });

  it('sorts warehouses alphabetically by employee/warehouse name', () => {
    const sorted = sortBalancesByWarehouse([
      { warehouse_name: 'Склад Юг', hub_employee_name: 'Юрьев' },
      { warehouse_name: 'Склад А', hub_employee_name: 'Алексеев' },
      { warehouse_name: 'Склад Б', hub_employee_name: '' },
    ]);
    expect(sorted.map((row) => row.warehouse_name)).toEqual([
      'Склад А',
      'Склад Б',
      'Склад Юг',
    ]);
  });

  it('filters balances by free-text query', () => {
    const rows = [
      { nomenclature_name: 'Кабель HDMI', nomenclature_code: 'C-1', warehouse_name: 'Иванов' },
      {
        nomenclature_name: 'Мышь',
        nomenclature_code: 'M-2',
        warehouse_name: 'Петров',
        hub_employee_dept: 'Бухгалтерия',
      },
    ];
    expect(filterBalancesByText(rows, 'hdmi')).toHaveLength(1);
    expect(filterBalancesByText(rows, 'петров')).toHaveLength(1);
    expect(filterBalancesByText(rows, 'бухгалтерия')).toHaveLength(1);
    expect(filterBalancesByText(rows, '')).toHaveLength(2);
  });

  it('compares russian text stably', () => {
    expect(compareRuText('а', 'б')).toBeLessThan(0);
    expect(compareRuText('Б', 'а')).toBeGreaterThan(0);
  });

  it('marks equal 1C and Hub quantities as match', () => {
    expect(resolveHubBalanceMatch({ qty_balance: 2, hub_count: 2 })).toEqual({
      status: 'match',
      label: 'Сходится',
    });
    expect(resolveHubBalanceMatch({ qty_balance: 2.0, hub_count: 2 })).toEqual({
      status: 'match',
      label: 'Сходится',
    });
    expect(resolveHubBalanceMatch({ qty_balance: 8, hub_count: 0 })).toEqual({
      status: 'hub_under',
      label: '1С > Хаб',
    });
    expect(resolveHubBalanceMatch({ qty_balance: 0, hub_count: 3 })).toEqual({
      status: 'hub_over',
      label: '1С < Хаб',
    });
    expect(resolveHubBalanceMatch({ qty_balance: 1, hub_count: null }).status).toBe('unknown');
  });

  it('summarizes when every comparable row matches', () => {
    expect(summarizeHubBalanceMatches([
      { qty_balance: 2, hub_count: 2 },
      { qty_balance: 1, hub_count: 1 },
    ])).toMatchObject({ allMatch: true, match: 2, mismatch: 0 });
    expect(summarizeHubBalanceMatches([
      { qty_balance: 2, hub_count: 2 },
      { qty_balance: 8, hub_count: 0 },
    ]).allMatch).toBe(false);
  });
});
