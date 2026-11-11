import { describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';

import {
  buildConsumableQrLink,
  buildEquipmentQrDataUrl,
  buildEquipmentQrLink,
  buildEquipmentQrText,
  getQrScannerErrorMessage,
  getQrboxDimensions,
  isIgnorableQrFrameError,
  parseDatabaseQrPayload,
  parseInvNoFromQrText,
  parseEquipmentQrLink,
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

  it('builds and parses a browser-safe equipment link with database scope', () => {
    const link = buildEquipmentQrLink(
      { INV_NO: 'INV/7' },
      { origin: 'https://hubit.zsgp.ru', databaseId: 'OBJ-ITINVENT' },
    );

    expect(link).toBe('https://hubit.zsgp.ru/database?inv_no=INV%2F7&db_id=OBJ-ITINVENT');
    expect(parseEquipmentQrLink(link)).toEqual({
      invNo: 'INV/7',
      databaseId: 'OBJ-ITINVENT',
      tab: 'general',
    });
    expect(parseInvNoFromQrText(link)).toBe('INV/7');
  });

  it('builds and parses a consumable link carrying ITEMS.ID', () => {
    const link = buildConsumableQrLink(
      { ID: 4821, INV_NO: 'C-9' },
      { origin: 'https://hubit.zsgp.ru', databaseId: 'OBJ-ITINVENT' },
    );

    expect(link).toBe('https://hubit.zsgp.ru/database?consumable=4821&db_id=OBJ-ITINVENT');
    expect(parseDatabaseQrPayload(link)).toEqual({
      kind: 'consumable',
      itemId: '4821',
      invNo: '',
      databaseId: 'OBJ-ITINVENT',
      tab: 'general',
    });
    expect(parseInvNoFromQrText(link)).toBeNull();
    expect(parseEquipmentQrLink(link)).toBeNull();
  });

  it('rejects consumable links without a numeric ITEMS.ID', () => {
    expect(buildConsumableQrLink({ ID: 'abc' }, { origin: 'https://hubit.zsgp.ru' })).toBe('');
    expect(buildConsumableQrLink({ INV_NO: 'C-9' }, { origin: 'https://hubit.zsgp.ru' })).toBe('');
    expect(parseDatabaseQrPayload('https://hubit.zsgp.ru/database?consumable=abc')).toBeNull();
  });

  it('keeps equipment payload kind for legacy links and plain text', () => {
    expect(parseDatabaseQrPayload('https://hubit.zsgp.ru/database?inv_no=INV%2F7&db_id=main')).toEqual({
      kind: 'equipment',
      itemId: '',
      invNo: 'INV/7',
      databaseId: 'main',
      tab: 'general',
    });
    expect(parseDatabaseQrPayload('INV_NO: 1001\nSERIAL_NO: SN-1')).toEqual({
      kind: 'equipment',
      itemId: '',
      invNo: '1001',
      databaseId: '',
      tab: 'general',
    });
    expect(parseDatabaseQrPayload('2002')).toEqual({
      kind: 'equipment',
      itemId: '',
      invNo: '2002',
      databaseId: '',
      tab: 'general',
    });
    expect(parseDatabaseQrPayload('hubit://database?consumable=77&db_id=main')).toEqual({
      kind: 'consumable',
      itemId: '77',
      invNo: '',
      databaseId: 'main',
      tab: 'general',
    });
  });

  it('accepts the app scheme while rejecting unrelated URLs', () => {
    expect(parseEquipmentQrLink('hubit://database?inv_no=1001&db_id=main&tab=history')).toEqual({
      invNo: '1001',
      databaseId: 'main',
      tab: 'history',
    });
    expect(parseEquipmentQrLink('https://example.com/tasks?inv_no=1001')).toBeNull();
    expect(parseInvNoFromQrText('https://example.com/tasks?inv_no=1001')).toBeNull();
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

  it('shows site-settings hint for denied camera permission', () => {
    const message = getQrScannerErrorMessage(new Error(
      'Error getting userMedia, error = NotAllowedError: Permission denied',
    ));
    expect(message).toContain('настройки сайта');
    expect(message).toContain('камере');
  });

  it('maps a hanging camera prompt to a retry hint', () => {
    const timeoutError = new Error('камера не ответила на запрос разрешения');
    timeoutError.name = 'CameraPromptTimeout';
    const message = getQrScannerErrorMessage(timeoutError);
    expect(message).toContain('Разрешить доступ к камере');
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
