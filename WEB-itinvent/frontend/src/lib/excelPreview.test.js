import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import {
  columnLetter,
  EXCEL_PREVIEW_MAX_BYTES,
  EXCEL_PREVIEW_MAX_ROWS_PER_SHEET,
  EXCEL_PREVIEW_MAX_SHEETS,
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
    // HIGH-07: разбор не должен загрязнять Object.prototype.
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('rejects workbooks above the byte limit before parsing', async () => {
    const oversized = new Uint8Array(EXCEL_PREVIEW_MAX_BYTES + 1);
    await expect(parseExcelWorkbookFromBlob(oversized)).rejects.toThrow(/size limit/i);
  });

  it('parses only the first sheets up to the sheet limit', async () => {
    const workbook = XLSX.utils.book_new();
    for (let i = 0; i < EXCEL_PREVIEW_MAX_SHEETS + 5; i += 1) {
      const sheet = XLSX.utils.aoa_to_sheet([[`sheet-${i}`]]);
      XLSX.utils.book_append_sheet(workbook, sheet, `S${i}`);
    }
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const parsed = await parseExcelWorkbookFromBlob(new Uint8Array(bytes));

    expect(parsed.sheets).toHaveLength(EXCEL_PREVIEW_MAX_SHEETS);
    expect(parsed.sheets.at(-1).name).toBe(`S${EXCEL_PREVIEW_MAX_SHEETS - 1}`);
  });

  it('caps parsed rows per sheet', async () => {
    const workbook = XLSX.utils.book_new();
    const aoa = [['id']];
    for (let i = 0; i < EXCEL_PREVIEW_MAX_ROWS_PER_SHEET + 10; i += 1) aoa.push([i]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), 'Data');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const parsed = await parseExcelWorkbookFromBlob(new Uint8Array(bytes));

    expect(parsed.sheets[0].rows.length).toBeLessThanOrEqual(EXCEL_PREVIEW_MAX_ROWS_PER_SHEET);
  });
});
