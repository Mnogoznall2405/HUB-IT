import { describe, expect, it } from 'vitest';

import {
  buildEquipmentQrLabelContent,
} from './equipmentQrLabel';

describe('equipmentQrLabel', () => {
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
      modelName: 'Latitude 7440',
      serialNo: 'SN-100',
    }));

    const fallback = buildEquipmentQrLabelContent({ INV_NO: '1002' });
    expect(fallback.serialNo).toBe('Не указан');
  });

});
