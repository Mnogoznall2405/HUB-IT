import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDesktopCapabilityAvailable,
  requestDesktopEquipmentQrPrint,
  requestDesktopPrintCurrent,
} from '../../lib/desktopBridge';
import { buildEquipmentQrPrintBatch } from './equipmentQrPrint';
import { waitForEquipmentQrPrintImages } from './EquipmentQrPrintPortal';
import useEquipmentQrBatchPrint from './useEquipmentQrBatchPrint';

vi.mock('../../lib/desktopBridge', () => ({
  DESKTOP_CAPABILITIES_CHANGED_EVENT: 'hub-desktop-capabilities-changed',
  DESKTOP_EQUIPMENT_QR_PRINT_CAPABILITY: 'equipment-qr-print',
  isDesktopCapabilityAvailable: vi.fn(() => false),
  requestDesktopEquipmentQrPrint: vi.fn(),
  requestDesktopPrintCurrent: vi.fn(() => false),
}));

vi.mock('./equipmentQrPrint', () => ({
  buildEquipmentQrPrintBatch: vi.fn(),
  formatQrLabelCount: vi.fn((count) => `${count} этикетки`),
}));

vi.mock('./EquipmentQrPrintPortal', () => ({
  waitForEquipmentQrPrintImages: vi.fn(async () => true),
}));

const groupedEquipment = {
  Филиал: {
    Кабинет: [{ INV_NO: '1001', OWNER_DISPLAY_NAME: 'Иванов' }],
  },
};

const renderPrintHook = (options = {}) => {
  const onClearSelection = vi.fn();
  const hook = renderHook(() => useEquipmentQrBatchPrint({
    groupedEquipment,
    selectedItems: ['1001'],
    tableSort: { field: 'employee', direction: 'asc' },
    databaseId: 'ITINVENT',
    onClearSelection,
    ...options,
  }));
  return { ...hook, onClearSelection };
};

describe('useEquipmentQrBatchPrint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDesktopCapabilityAvailable.mockReturnValue(false);
    requestDesktopPrintCurrent.mockReturnValue(false);
    waitForEquipmentQrPrintImages.mockResolvedValue(true);
    buildEquipmentQrPrintBatch.mockResolvedValue({
      labels: [{ invNo: '1001', dataUrl: 'data:image/png;base64,label' }],
      skippedInvNos: [],
    });
    vi.spyOn(window, 'print').mockImplementation(() => {});
  });

  it('opens the browser dialog and clears selection after the prepared batch is accepted', async () => {
    const { result, onClearSelection } = renderPrintHook();

    await act(async () => {
      await result.current.printWithDialog();
    });

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(waitForEquipmentQrPrintImages).toHaveBeenCalledTimes(1);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(result.current.feedback).toEqual(expect.objectContaining({
      severity: 'info',
      canRepeat: true,
    }));
  });

  it('falls back to the Desktop printer dialog when quick printing fails', async () => {
    isDesktopCapabilityAvailable.mockReturnValue(true);
    requestDesktopEquipmentQrPrint
      .mockResolvedValueOnce({ accepted: false, status: 'failed' })
      .mockResolvedValueOnce({ accepted: true, status: 'dialog-opened' });
    const { result, onClearSelection } = renderPrintHook();

    await act(async () => {
      await result.current.printQuick();
    });

    await waitFor(() => expect(requestDesktopEquipmentQrPrint).toHaveBeenCalledTimes(2));
    expect(requestDesktopEquipmentQrPrint).toHaveBeenNthCalledWith(1, 'quick');
    expect(requestDesktopEquipmentQrPrint).toHaveBeenNthCalledWith(2, 'dialog');
    expect(window.print).not.toHaveBeenCalled();
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('lists skipped inventory numbers and does not offer repeat without a prepared label', async () => {
    buildEquipmentQrPrintBatch.mockResolvedValue({
      labels: [],
      skippedInvNos: ['1001'],
    });
    const { result, onClearSelection } = renderPrintHook();

    await act(async () => {
      await result.current.printWithDialog();
    });

    expect(result.current.feedback).toEqual(expect.objectContaining({
      severity: 'warning',
      canRepeat: false,
      message: expect.stringContaining('1001'),
    }));
    expect(window.print).not.toHaveBeenCalled();
    expect(onClearSelection).not.toHaveBeenCalled();
  });
});
