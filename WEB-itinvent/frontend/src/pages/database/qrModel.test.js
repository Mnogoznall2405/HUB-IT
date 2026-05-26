import { describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';

import {
  buildEquipmentQrDataUrl,
  buildEquipmentQrText,
  getQrScannerErrorMessage,
  getQrboxDimensions,
  isIgnorableQrFrameError,
  parseInvNoFromQrText,
  stopQrScannerInstance,
} from './qrModel';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async () => 'data:image/png;base64,test'),
  },
}));

describe('qrModel', () => {
  it('builds stable QR text from equipment fields', () => {
    expect(buildEquipmentQrText({
      INV_NO: '1001',
      SERIAL_NO: 'SN-1',
      MODEL_NAME: 'OptiPlex',
      PART_NO: 'PN-1',
    })).toBe([
      'INV_NO: 1001',
      'SERIAL_NO: SN-1',
      'MODEL: OptiPlex',
      'PART_NO: PN-1',
    ].join('\n'));

    expect(buildEquipmentQrText({ inv_no: '2002' })).toContain('SERIAL_NO: -');
  });

  it('parses inventory numbers from structured and simple QR text', () => {
    expect(parseInvNoFromQrText('INV_NO: 1001\nSERIAL_NO: SN-1')).toBe('1001');
    expect(parseInvNoFromQrText(' 2002 ')).toBe('2002');
    expect(parseInvNoFromQrText('INV_NO: -\nMODEL: none')).toBeNull();
    expect(parseInvNoFromQrText('SERIAL_NO: SN-1\nMODEL: OptiPlex')).toBeNull();
  });

  it('generates a QR data URL only for non-empty payloads', async () => {
    await expect(buildEquipmentQrDataUrl('INV_NO: 1001')).resolves.toBe('data:image/png;base64,test');
    expect(QRCode.toDataURL).toHaveBeenCalledWith('INV_NO: 1001', expect.objectContaining({
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
    }));

    await expect(buildEquipmentQrDataUrl('')).resolves.toBe('');
  });

  it('maps scanner startup errors and ignores frame-level parse noise', () => {
    expect(getQrScannerErrorMessage(new Error('custom failure'))).toContain('custom failure');
    expect(isIgnorableQrFrameError('No MultiFormat Readers were able to detect the code')).toBe(true);
    expect(isIgnorableQrFrameError('fatal camera error')).toBe(false);
  });

  it('shows browser hint for denied camera permission', () => {
    const message = getQrScannerErrorMessage(new Error(
      'Error getting userMedia, error = NotAllowedError: Permission denied',
    ));
    expect(message).toContain('браузере');
    expect(message).toContain('камере');
  });

  it('keeps QR scanner box dimensions bounded', () => {
    expect(getQrboxDimensions(0, 0)).toEqual({ width: 220, height: 220 });
    expect(getQrboxDimensions(100, 100)).toEqual({ width: 140, height: 140 });
    expect(getQrboxDimensions(1000, 1000)).toEqual({ width: 260, height: 260 });
  });

  it('stops and clears scanner instances while tolerating already-stopped errors', async () => {
    const scanner = {
      stop: vi.fn(async () => {
        throw new Error('not running');
      }),
      clear: vi.fn(),
    };

    await stopQrScannerInstance(scanner);

    expect(scanner.stop).toHaveBeenCalledTimes(1);
    expect(scanner.clear).toHaveBeenCalledTimes(1);
  });
});
