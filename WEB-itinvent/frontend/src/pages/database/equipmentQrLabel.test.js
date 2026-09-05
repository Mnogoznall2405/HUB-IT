import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildEquipmentQrLabelContent,
  buildEquipmentQrLabelDataUrl,
} from './equipmentQrLabel';

describe('equipmentQrLabel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds human-readable equipment details with useful fallbacks', () => {
    expect(buildEquipmentQrLabelContent({
      INV_NO: 'INV-100',
      SERIAL_NO: 'SN-100',
      HW_SERIAL_NO: 'HW-100',
      PART_NO: 'PN-100',
      TYPE_NAME: 'Ноутбук',
      MODEL_NAME: 'Latitude 7440',
      VENDOR_NAME: 'Dell',
      OWNER_DISPLAY_NAME: 'Иван Петров',
      BRANCH_NAME: 'Главный офис',
      LOCATION_NAME: 'Кабинет 12',
    })).toEqual(expect.objectContaining({
      brandName: 'HUB-IT',
      invNo: 'INV-100',
      serialNo: 'SN-100',
    }));

    const fallback = buildEquipmentQrLabelContent({ INV_NO: '1002' });
    expect(fallback.serialNo).toBe('Не указан');
  });

  it('renders a self-contained PNG label with the QR and HUB logo', async () => {
    const longSerialNo = `SN-${'1234567890'.repeat(12)}`;
    const context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text) => ({ width: String(text).length * 8 })),
      strokeRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: '',
      filter: '',
      font: '',
      textAlign: '',
      strokeStyle: '',
      lineWidth: 0,
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,label'),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => (
      tagName === 'canvas' ? canvas : createElement(tagName, options)
    ));

    const OriginalImage = globalThis.Image;
    class MockImage {
      set src(value) {
        this.currentSrc = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = MockImage;

    try {
      await expect(buildEquipmentQrLabelDataUrl({
        equipment: { INV_NO: '1001', SERIAL_NO: longSerialNo },
        qrDataUrl: 'data:image/png;base64,qr',
      })).resolves.toBe('data:image/png;base64,label');
    } finally {
      globalThis.Image = OriginalImage;
    }

    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(1000);
    expect(canvas.width / canvas.height).toBe(1);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.restore).toHaveBeenCalledTimes(1);
    expect(context.strokeRect).toHaveBeenCalledTimes(1);
    expect(context.strokeRect).toHaveBeenCalledWith(1.5, 1.5, 997, 997);
    expect(context.strokeStyle).toBe('#000000');
    expect(context.lineWidth).toBe(3);
    expect(context.fillText).toHaveBeenCalledWith('HUB-IT', expect.any(Number), expect.any(Number));
    expect(context.fillText).toHaveBeenCalledWith('Инв. №', 500, 135);
    expect(context.fillText).toHaveBeenCalledWith('1001', 500, 195, 880);
    expect(context.fillText).toHaveBeenCalledWith('Серийный номер', 500, 862);
    expect(context.fillText).toHaveBeenCalledWith(longSerialNo, 500, 936, 880);
    expect(context.fillText.mock.calls.map(([text]) => text)).not.toContain(
      expect.stringContaining('…')
    );
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
  });
});
