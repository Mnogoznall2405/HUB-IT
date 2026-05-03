import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseQrScanner } from './useDatabaseQrScanner';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    getByInvNo: vi.fn(),
  },
}));

const renderQrHook = (options = {}) => renderHook(() => useDatabaseQrScanner({
  autoStart: false,
  ...options,
}));

describe('useDatabaseQrScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens and closes while resetting transient scanner state', async () => {
    const { result } = renderQrHook();

    act(() => {
      result.current.openQrScanner();
    });

    expect(result.current.qrScannerOpen).toBe(true);
    expect(result.current.qrScannerResult).toBe('');
    expect(result.current.qrScannerError).toBe('');
    expect(result.current.qrScannerLoading).toBe(false);
    expect(result.current.qrScannerReady).toBe(false);

    await act(async () => {
      await result.current.handleQrScanSuccess('SERIAL_NO: SN-1\nMODEL: OptiPlex');
    });

    expect(result.current.qrScannerError).toBeTruthy();
    expect(result.current.qrScannerResult).toContain('SERIAL_NO');

    act(() => {
      result.current.closeQrScanner();
    });

    expect(result.current.qrScannerOpen).toBe(false);
    expect(result.current.qrScannerResult).toBe('');
    expect(result.current.qrScannerError).toBe('');
    expect(result.current.qrScannerLoading).toBe(false);
    expect(result.current.qrScannerReady).toBe(false);
  });

  it('sets an error for invalid QR text without calling the API', async () => {
    const { result } = renderQrHook();

    await act(async () => {
      await result.current.handleQrScanSuccess('SERIAL_NO: SN-1\nMODEL: OptiPlex');
    });

    expect(equipmentAPI.getByInvNo).not.toHaveBeenCalled();
    expect(result.current.qrScannerResult).toBe('SERIAL_NO: SN-1\nMODEL: OptiPlex');
    expect(result.current.qrScannerError).toBeTruthy();
    expect(result.current.qrScannerLoading).toBe(false);
  });

  it('loads equipment by parsed inventory number and calls onEquipmentFound', async () => {
    const found = { INV_NO: '1001', MODEL_NAME: 'OptiPlex' };
    const onEquipmentFound = vi.fn();
    equipmentAPI.getByInvNo.mockResolvedValue(found);
    const { result } = renderQrHook({ onEquipmentFound });

    act(() => {
      result.current.openQrScanner();
    });

    await act(async () => {
      await result.current.handleQrScanSuccess('INV_NO: 1001\nMODEL: OptiPlex');
    });

    expect(equipmentAPI.getByInvNo).toHaveBeenCalledWith('1001');
    expect(onEquipmentFound).toHaveBeenCalledWith(found, '1001');
    expect(result.current.qrScannerOpen).toBe(false);
    expect(result.current.qrScannerResult).toBe('');
    expect(result.current.qrScannerError).toBe('');
    expect(result.current.qrScannerLoading).toBe(false);
    expect(result.current.qrScannerReady).toBe(false);
  });

  it('reports 404 lookup errors through scanner state and notification callback', async () => {
    const notifyDatabaseError = vi.fn();
    equipmentAPI.getByInvNo.mockRejectedValue({
      response: { status: 404, data: {} },
    });
    const { result } = renderQrHook({ notifyDatabaseError });

    await act(async () => {
      await result.current.handleQrScanSuccess('404-INV');
    });

    expect(equipmentAPI.getByInvNo).toHaveBeenCalledWith('404-INV');
    expect(result.current.qrScannerError).toContain('404-INV');
    expect(result.current.qrScannerLoading).toBe(false);
    expect(notifyDatabaseError).toHaveBeenCalledWith(expect.stringContaining('404-INV'));
  });
});
