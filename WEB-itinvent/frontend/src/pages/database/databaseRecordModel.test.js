import { describe, expect, it } from 'vitest';

import {
  normalizeDbId,
  normalizeText,
  readFirst,
  readQty,
  toIdOrNull,
  toNumberOrNull,
} from './databaseRecordModel';

describe('databaseRecordModel', () => {
  it('normalizes database ids and free text', () => {
    expect(normalizeDbId(' main ')).toBe('main');
    expect(normalizeDbId(null)).toBe('');
    expect(normalizeText('  OptiPlex  ')).toBe('optiplex');
  });

  it('reads the first present API field preserving empty strings', () => {
    expect(readFirst({ INV_NO: '1001', inv_no: 'lower' }, ['inv_no', 'INV_NO'])).toBe('lower');
    expect(readFirst({ name: '' }, ['name'], 'fallback')).toBe('');
    expect(readFirst({ value: null }, ['value'], 'fallback')).toBe('fallback');
  });

  it('normalizes ids and numeric fields without inventing fallback values', () => {
    expect(toNumberOrNull('42')).toBe(42);
    expect(toNumberOrNull('bad')).toBeNull();
    expect(toNumberOrNull('')).toBeNull();
    expect(toIdOrNull(77)).toBe('77');
    expect(toIdOrNull(null)).toBeNull();
  });

  it('reads quantities with fallback for invalid values', () => {
    expect(readQty({ QTY: '5' })).toBe(5);
    expect(readQty({ qty: 'bad' }, 2)).toBe(2);
  });
});
