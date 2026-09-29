import type { Warehouse1CBalance } from '../api/warehouse1cApi';
import {
  buildCompareMaps,
  compareQtyBreakdown,
  isNotIn1cPartNo,
  isUsableHubPartNo,
  isWarehouse1cBalancesMetaIncomplete,
  normalizeCompareKey,
  resolve1cRowStatus,
  resolveHubRowStatus,
  summarizeCompareMaps,
} from './warehouse1cCompare';

const balance = (nomenclatureCode: string, qtyBalance: number): Warehouse1CBalance => ({
  nomenclatureRef: `ref-${nomenclatureCode}`,
  nomenclatureCode,
  nomenclatureName: `Позиция ${nomenclatureCode}`,
  characteristicName: '',
  seriesRef: '',
  seriesName: '',
  seriesNumber: '',
  warehouseRef: 'wh-1',
  warehouseName: 'Склад Иванов',
  qtyBalance,
  costBalance: 0,
  costAccountingBalance: 0,
  avgPrice: 0,
  batchStatusName: '',
  costMethodName: '',
  torg12Number: '',
  torg12Date: '',
  invoiceNumber: '',
  invoiceDate: '',
});

describe('part_no predicates', () => {
  it('treats sentinels and placeholders as unusable', () => {
    expect(isUsableHubPartNo('')).toBe(false);
    expect(isUsableHubPartNo('-')).toBe(false);
    expect(isUsableHubPartNo('—')).toBe(false);
    expect(isUsableHubPartNo('Не найден')).toBe(false);
    expect(isUsableHubPartNo('не найден в базе')).toBe(false);
    expect(isUsableHubPartNo('Нет в 1С')).toBe(false);
    expect(isUsableHubPartNo('PN-12345')).toBe(true);
    expect(isNotIn1cPartNo('нет в 1с')).toBe(true);
    expect(isNotIn1cPartNo('PN-1')).toBe(false);
  });
});

describe('buildCompareMaps + row statuses', () => {
  const maps = buildCompareMaps({
    hubItems: [
      { part_no: 'PN-1' },
      { part_no: 'PN-2' },
      { part_no: 'PN-2' },
      { part_no: 'PN-9' },
      { part_no: 'Нет в 1С' },
      { part_no: '' },
    ],
    balances: [
      balance('pn-1', 1),
      balance('pn-2', 1),
      balance('pn-3', 2),
      balance('', 5),
    ],
  });

  it('resolves match / diff / only_* per row', () => {
    expect(resolveHubRowStatus('PN-1', maps)).toBe('match');
    expect(resolveHubRowStatus('PN-2', maps)).toBe('diff');
    expect(resolveHubRowStatus('PN-9', maps)).toBe('only_hub');
    expect(resolveHubRowStatus('Нет в 1С', maps)).toBeNull();
    expect(resolve1cRowStatus('pn-3', maps)).toBe('only_1c');
    expect(resolve1cRowStatus('', maps)).toBeNull();
  });

  it('aggregates repeated 1C rows by code before comparing', () => {
    const aggregated = buildCompareMaps({
      hubItems: [{ part_no: 'PN-4' }, { part_no: 'PN-4' }],
      balances: [balance('pn-4', 1), balance('pn-4', 1)],
    });
    expect(resolve1cRowStatus('PN-4', aggregated)).toBe('match');
  });

  it('summarizes statuses and reports qty breakdown', () => {
    expect(summarizeCompareMaps(maps)).toEqual({ matched: 1, diff: 1, onlyHub: 1, only1c: 1 });
    expect(compareQtyBreakdown('PN-2', maps)).toEqual({ hubCount: 2, qty1c: 1 });
    expect(compareQtyBreakdown('unknown', maps)).toBeNull();
  });
});

describe('meta completeness', () => {
  it('flags missing/truncated metadata as incomplete', () => {
    expect(isWarehouse1cBalancesMetaIncomplete(null)).toBe(true);
    expect(isWarehouse1cBalancesMetaIncomplete({ status: 'ok' } as never)).toBe(false);
    expect(isWarehouse1cBalancesMetaIncomplete({ status: 'ok', hasMore: true } as never)).toBe(true);
    expect(isWarehouse1cBalancesMetaIncomplete({ status: 'unknown' } as never)).toBe(true);
  });

  it('normalizeCompareKey collapses whitespace and case', () => {
    expect(normalizeCompareKey('  PN   77 ')).toBe('pn 77');
  });
});
