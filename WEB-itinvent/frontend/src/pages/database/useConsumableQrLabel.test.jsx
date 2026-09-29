import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { waitForEquipmentQrPrintImages } from './EquipmentQrPrintPortal';
import {
  normalizeConsumableQrPrintGrid,
  useConsumableQrLabel,
} from './useConsumableQrLabel';

vi.mock('../../lib/desktopBridge', () => ({
  DESKTOP_CAPABILITIES_CHANGED_EVENT: 'hub-desktop-capabilities-changed',
  DESKTOP_EQUIPMENT_QR_PRINT_CAPABILITY: 'equipment-qr-print',
  isDesktopCapabilityAvailable: vi.fn(() => false),
  requestDesktopEquipmentQrPrint: vi.fn(),
  requestDesktopPrintCurrent: vi.fn(() => false),
}));

vi.mock('./qrModel', () => ({
  buildConsumableQrLink: vi.fn(() => 'https://hub/database?consumable=42'),
  buildEquipmentQrDataUrl: vi.fn(async () => 'data:image/png;base64,qr'),
}));

vi.mock('./equipmentQrLabel', () => ({
  buildConsumableQrLabelDataUrl: vi.fn(async () => 'data:image/png;base64,label'),
}));

vi.mock('./EquipmentQrPrintPortal', () => ({
  waitForEquipmentQrPrintImages: vi.fn(async () => true),
}));

const item = { ID: 42, INV_NO: 'C-7', MODEL_NAME: 'CF283A', QTY: 7 };

const renderLabelHook = (options = {}) =>
  renderHook(() => useConsumableQrLabel({ databaseId: 'ITINVENT', ...options }));

describe('useConsumableQrLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitForEquipmentQrPrintImages.mockResolvedValue(true);
    vi.spyOn(window, 'print').mockImplementation(() => {});
  });

  it('keeps print labels mounted until afterprint so page chrome cannot leak onto paper', async () => {
    const { result } = renderLabelHook();

    act(() => { result.current.openConsumableQr(item); });
    await waitFor(() => expect(result.current.consumableQrUrl).toBe('data:image/png;base64,qr'));

    await act(async () => { await result.current.printConsumableQr(); });
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));

    expect(result.current.consumableQrPrintLabels).toHaveLength(1);
    expect(result.current.consumableQrPrinting).toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(result.current.consumableQrPrintLabels).toHaveLength(0);
  });

  it('builds a label per selected consumable for the batch sheet and applies the 6x6 grid', async () => {
    const { result } = renderLabelHook();
    const second = { ...item, ID: 43, INV_NO: 'C-8' };

    act(() => { result.current.openConsumableQrPrintBatch(); });
    expect(result.current.consumableQrBatchOpen).toBe(true);

    await act(async () => {
      await result.current.printConsumableQrBatch([item, second], { columns: 6, rows: 6 });
    });
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));

    expect(result.current.consumableQrBatchOpen).toBe(false);
    expect(result.current.consumableQrPrintLabels).toHaveLength(2);
    expect(result.current.consumableQrPrintGrid).toEqual(expect.objectContaining({
      columns: 6,
      rows: 6,
    }));

    await act(async () => {
      window.dispatchEvent(new Event('afterprint'));
    });
  });

  it('normalizes the sheet grid and clamps out-of-range values', () => {
    expect(normalizeConsumableQrPrintGrid()).toEqual(expect.objectContaining({ columns: 6, rows: 6 }));
    expect(normalizeConsumableQrPrintGrid({ columns: '4', rows: '3' })).toEqual(
      expect.objectContaining({ columns: 4, rows: 3 })
    );
    expect(normalizeConsumableQrPrintGrid({ columns: 0, rows: 99 })).toEqual(
      expect.objectContaining({ columns: 6, rows: 10 })
    );
    expect(normalizeConsumableQrPrintGrid({ columns: 6, rows: 6 })).toEqual(
      expect.objectContaining({ cellWidthMm: 33.33, cellHeightMm: 47.83 })
    );
  });
});
