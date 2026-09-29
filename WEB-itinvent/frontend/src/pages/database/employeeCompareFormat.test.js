import { describe, expect, it } from 'vitest';

import { buildCompareMaps } from './employeeCompareModel';
import { buildDiscrepanciesText, buildMissingWarehouseTaskText } from './employeeCompareFormat';

const hubItem = (overrides = {}) => ({
  inv_no: '100665',
  model_name: 'Монитор Dell',
  part_no: 'БУ-777',
  ...overrides,
});

const balanceRow = (overrides = {}) => ({
  nomenclature_code: 'БУ-900',
  nomenclature_name: 'Мышь Logitech',
  qty_balance: 2,
  ...overrides,
});

const baseArgs = () => {
  const hubItems = [hubItem()];
  const balances = [balanceRow()];
  return {
    employeeName: 'Иван Иванов',
    comparisonComplete: true,
    hubItems,
    warehouseBalances: balances,
    compareMaps: buildCompareMaps({ hubItems, balances }),
  };
};

describe('buildDiscrepanciesText', () => {
  it('renders plain inv numbers by default', () => {
    const text = buildDiscrepanciesText(baseArgs());
    expect(text).toContain('Сверка с 1С — Иван Иванов');
    expect(text).toContain('• 100665 · Монитор Dell — только в Хабе');
    expect(text).toContain('• БУ-900 Мышь Logitech — только в 1С (2,000)');
    expect(text).not.toContain('](');
  });

  it('wraps inv numbers into markdown links when makeInvLink is given', () => {
    const text = buildDiscrepanciesText({
      ...baseArgs(),
      makeInvLink: (_item, invNo) => `/database?inv_no=${encodeURIComponent(invNo)}`,
    });
    expect(text).toContain('• [100665](/database?inv_no=100665) · Монитор Dell — только в Хабе');
    // Позиции «только в 1С» без инв. № остаются текстом.
    expect(text).toContain('• БУ-900 Мышь Logitech — только в 1С (2,000)');
  });

  it('leaves inv number plain when makeInvLink returns empty', () => {
    const text = buildDiscrepanciesText({ ...baseArgs(), makeInvLink: () => '' });
    expect(text).toContain('• 100665 · Монитор Dell — только в Хабе');
  });
});

describe('buildMissingWarehouseTaskText', () => {
  it('lists hub items, warehouse candidates and suggested warehouses', () => {
    const text = buildMissingWarehouseTaskText({
      employeeName: 'Иван Иванов',
      hubItems: [hubItem()],
      warehouseCandidates: [{ name: 'Склад Иванова' }],
      codeHints: [
        {
          code: 'БУ-777',
          warehouses: [
            { warehouse_name: 'Склад Петрова', employee_name: 'Петров П.П.', qty: 2, has_in_hub: false },
            { warehouse_name: 'Склад Сидорова', employee_name: 'Сидоров С.С.', qty: 1, has_in_hub: true },
          ],
          hub_holders: [{ employee_name: 'Иванов И.И.', count: 3 }],
        },
        { code: 'БУ-999', warehouses: [], hub_holders: [] },
      ],
      previousOwners: { '100665': ['Сидоров С.С.'] },
      makeInvLink: (_item, invNo) => `/database?inv_no=${encodeURIComponent(invNo)}`,
    });
    expect(text).toContain('Склад 1С не найден — Иван Иванов');
    expect(text).toContain('создать склад 1С за сотрудником и переместить');
    expect(text).toContain('Возможные склады в 1С: Склад Иванова');
    expect(text).toContain('• [100665](/database?inv_no=100665) · Монитор Dell — парт. № БУ-777 · раньше: Сидоров С.С.');
    // Предлагается только склад без такой позиции в Хабе; has_in_hub — пропускаем.
    expect(text).toContain('склад «Склад Петрова» (Петров П.П.) — 2,000 шт., в Хабе у него такой позиции нет');
    expect(text).not.toContain('Склад Сидорова»');
    expect(text).toContain('• БУ-999: на складах 1С остатков не найдено');
    expect(text).toContain('в Хабе есть у: Иванов И.И. (3 шт.)');
  });
});
