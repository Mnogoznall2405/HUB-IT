import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEquipmentQrPrintBatch, formatQrLabelCount } from './equipmentQrPrint';
import { buildEquipmentQrLabelDataUrl } from './equipmentQrLabel';
import { buildEquipmentQrDataUrl } from './qrModel';

vi.mock('./qrModel', () => ({
  buildEquipmentQrLink: vi.fn((item) => (
    item?.INV_NO ? `https://hubit.zsgp.ru/database?inv_no=${item.INV_NO}` : ''
  )),
  buildEquipmentQrDataUrl: vi.fn(async (link) => `qr:${link}`),
}));

vi.mock('./equipmentQrLabel', () => ({
  buildEquipmentQrLabelDataUrl: vi.fn(async ({ equipment }) => `label:${equipment.INV_NO}`),
}));

describe('equipmentQrPrint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prepares labels in input order and reports unresolved rows', async () => {
    await expect(buildEquipmentQrPrintBatch({
      items: [{ INV_NO: '1002' }, { INV_NO: '1001' }],
      databaseId: 'ITINVENT',
      skippedInvNos: ['missing'],
    })).resolves.toEqual({
      labels: [
        { invNo: '1002', dataUrl: 'label:1002' },
        { invNo: '1001', dataUrl: 'label:1001' },
      ],
      skippedInvNos: ['missing'],
    });

    expect(buildEquipmentQrDataUrl).toHaveBeenCalledTimes(2);
    expect(buildEquipmentQrLabelDataUrl).toHaveBeenCalledTimes(2);
  });

  it('skips a label when its raster generation fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    buildEquipmentQrLabelDataUrl
      .mockResolvedValueOnce('label:1001')
      .mockRejectedValueOnce(new Error('canvas failed'));

    await expect(buildEquipmentQrPrintBatch({
      items: [{ INV_NO: '1001' }, { INV_NO: '1002' }],
    })).resolves.toEqual({
      labels: [{ invNo: '1001', dataUrl: 'label:1001' }],
      skippedInvNos: ['1002'],
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to prepare QR label 1002:',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it('uses Russian label-count forms', () => {
    expect(formatQrLabelCount(1)).toBe('1 этикетка');
    expect(formatQrLabelCount(2)).toBe('2 этикетки');
    expect(formatQrLabelCount(5)).toBe('5 этикеток');
    expect(formatQrLabelCount(11)).toBe('11 этикеток');
    expect(formatQrLabelCount(21)).toBe('21 этикетка');
  });
});
