import { describe, expect, it } from 'vitest';

import {
  buildEmployeeEquipmentSheet,
  formatEmployeeEquipmentFilename,
  sanitizeSheetName,
  shouldShowHubDbColumn,
} from './employeeEquipmentExcel';

const exportedAt = new Date(2026, 7, 18, 11, 19);

describe('employeeEquipmentExcel', () => {
  it('places Hub and 1C tables side by side on one sheet', () => {
    const sheet = buildEmployeeEquipmentSheet({
      employeeName: 'Иванова Екатерина Юрьевна',
      hubItems: [
        {
          INV_NO: 'INV-1',
          MODEL_NAME: 'ThinkPad',
          SERIAL_NO: 'SN-1',
          PART_NO: 'PN-1',
        },
        {
          inv_no: 'INV-2',
          model_name: 'Dell',
          serial_no: 'SN-2',
          part_no: 'PN-2',
        },
      ],
      warehouseBalances: [
        { nomenclature_code: '10', nomenclature_name: 'Кабель', qty_balance: 2 },
        { nomenclature_code: '11', nomenclature_name: 'Мышь', qty_balance: 1.5 },
      ],
      warehouseName: 'Иванова Екатерина Юрьевна',
      warehouseStatus: 'matched',
      includeWarehouse: true,
      exportedAt,
    });

    expect(sheet.sheetName).toBe('Иванова Екатерина Юрьевна');
    expect(sheet.aoa[0]).toEqual(['Сотрудник', 'Иванова Екатерина Юрьевна']);
    expect(sheet.aoa[1][0]).toBe('Дата выгрузки');

    const sectionRow = sheet.aoa[3];
    expect(sectionRow[0]).toBe('В Хабе (2)');
    expect(sectionRow[5]).toBe('Склад 1С — Иванова Екатерина Юрьевна (2)');

    const headerRow = sheet.aoa[4];
    expect(headerRow.slice(0, 4)).toEqual(['Инв. №', 'Модель', 'Серийник', 'Парт. №']);
    expect(headerRow.slice(5)).toEqual(['Код', 'Номенклатура', 'Кол-во']);

    expect(sheet.aoa[5].slice(0, 4)).toEqual(['INV-1', 'ThinkPad', 'SN-1', 'PN-1']);
    expect(sheet.aoa[5].slice(5)).toEqual(['10', 'Кабель', 2]);
    expect(sheet.aoa[6].slice(0, 4)).toEqual(['INV-2', 'Dell', 'SN-2', 'PN-2']);
    expect(sheet.aoa[6].slice(5)).toEqual(['11', 'Мышь', 1.5]);
    expect(sheet.freezeRows).toBe(5);
    expect(sheet.merges).toHaveLength(2);
  });

  it('keeps only the Hub table when warehouse export is disabled', () => {
    const sheet = buildEmployeeEquipmentSheet({
      employeeName: 'Петров П.П.',
      hubItems: [{ INV_NO: 'INV-9', MODEL_NAME: 'ПК', SERIAL_NO: 'X', PART_NO: '' }],
      includeWarehouse: false,
      exportedAt,
    });

    expect(sheet.aoa[3][0]).toBe('В Хабе (1)');
    expect(sheet.aoa[4]).toEqual(['Инв. №', 'Модель', 'Серийник', 'Парт. №']);
    expect(sheet.aoa[5]).toEqual(['INV-9', 'ПК', 'X', '']);
    expect(sheet.aoa.every((row) => !String(row || '').includes('Склад 1С'))).toBe(true);
  });

  it('adds a database column when Hub items come from more than one base', () => {
    const items = [
      { INV_NO: '1', hub_db_id: 'msk', hub_db_name: 'MSK', is_current_db: true },
      { INV_NO: '2', hub_db_id: 'spb', hub_db_name: 'SPB', is_current_db: false },
    ];
    expect(shouldShowHubDbColumn(items)).toBe(true);

    const sheet = buildEmployeeEquipmentSheet({
      employeeName: 'Сидоров',
      hubItems: items,
      includeWarehouse: false,
      exportedAt,
    });
    expect(sheet.aoa[4]).toEqual(['Инв. №', 'Модель', 'Серийник', 'Парт. №', 'База']);
    expect(sheet.aoa[5][4]).toBe('MSK');
    expect(sheet.aoa[6][4]).toBe('SPB');
  });

  it('notes an active filter and empty warehouse status', () => {
    const sheet = buildEmployeeEquipmentSheet({
      employeeName: 'Иванов',
      hubItems: [],
      warehouseBalances: [],
      warehouseStatus: 'not_found',
      includeWarehouse: true,
      filterText: 'кабель',
      exportedAt,
    });

    expect(sheet.aoa[2]).toEqual(['Фильтр', 'кабель']);
    expect(sheet.aoa[4][0]).toBe('В Хабе (0)');
    expect(sheet.aoa[4][5]).toBe('Склад 1С: не найден');
    expect(sheet.aoa[6][0]).toBe('Нет оборудования');
    expect(sheet.aoa[6][5]).toBe('Склад не найден');
  });

  it('sanitizes filename and sheet name for Excel', () => {
    expect(sanitizeSheetName('Иванов / Склад:*')).toBe('Иванов Склад');
    expect(formatEmployeeEquipmentFilename('Иванов И.И.', exportedAt))
      .toBe('оборудование-Иванов-И.И.-2026-08-18-11-19.xlsx');
  });
});
