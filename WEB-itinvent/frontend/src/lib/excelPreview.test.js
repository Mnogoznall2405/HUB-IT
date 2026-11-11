import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  columnLetter,
  parseExcelWorkbookFromBlob,
  sliceExcelRows,
} from './excelPreview';

describe('excelPreview', () => {
  it('builds column letters for Excel headers', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
  });

  it('slices rows for teaser preview', () => {
    expect(sliceExcelRows([
      ['A1', 'B1', 'C1'],
      ['A2', 'B2', 'C2'],
      ['A3', 'B3', 'C3'],
    ], { maxRows: 2, maxCols: 2 })).toEqual([
      ['A1', 'B1'],
      ['A2', 'B2'],
    ]);
  });

  it('parses workbook sheets from xlsx blob', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Проект', 'Сумма'],
      ['Арктика', 1000],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const parsed = await parseExcelWorkbookFromBlob(new Uint8Array(bytes));

    expect(parsed.sheetNames).toHaveLength(1);
    expect(parsed.sheets[0].name).toBeTruthy();
    expect(parsed.sheets[0].rows[0]).toEqual(['Проект', 'Сумма']);
    expect(parsed.sheets[0].rows[1][0]).toBe('Арктика');
    expect(String(parsed.sheets[0].rows[1][1])).toBe('1000');
  });
});
