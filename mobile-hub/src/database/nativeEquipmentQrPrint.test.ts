import { HUB_WEB_ORIGIN } from '../api/config';
import { parseInventoryQrPayload } from './nativeDatabaseModel';
import { buildNativeEquipmentQrLink, buildNativeEquipmentQrPrintHtml } from './nativeEquipmentQrPrint';

describe('buildNativeEquipmentQrLink', () => {
  it('builds the web /database link that round-trips through the native scanner parser', () => {
    const link = buildNativeEquipmentQrLink({ inv_no: '  АБВ-123/4 ' }, 'MSK-ITINVENT');
    expect(link.startsWith(`${HUB_WEB_ORIGIN}/database`)).toBe(true);
    expect(link).toContain('db_id=MSK-ITINVENT');
    expect(parseInventoryQrPayload(link)).toEqual({
      kind: 'equipment',
      inventoryNumber: 'АБВ-123/4',
      databaseId: 'MSK-ITINVENT',
    });
  });

  it('omits db_id when no database is selected', () => {
    const link = buildNativeEquipmentQrLink({ inv_no: 'INV-1' });
    expect(link).not.toContain('db_id');
    expect(parseInventoryQrPayload(link)).toEqual({
      kind: 'equipment',
      inventoryNumber: 'INV-1',
      databaseId: '',
    });
  });

  it('rejects an empty inventory number', () => {
    expect(() => buildNativeEquipmentQrLink({ inv_no: '   ' })).toThrow();
  });
});

describe('buildNativeEquipmentQrPrintHtml', () => {
  it('renders a 56x50mm label with an SVG QR code and card metadata', async () => {
    const html = await buildNativeEquipmentQrPrintHtml(
      { inv_no: 'INV-1', model_name: 'OptiPlex 7010', serial_no: 'SN-7' },
      'ITINVENT',
    );
    expect(html).toContain('<svg');
    expect(html).toContain('size: 56mm 50mm');
    expect(html).toContain('width: 39mm');
    expect(html).toContain('Инв. № INV-1');
    expect(html).toContain('OptiPlex 7010');
    expect(html).toContain('SN-7');
    const encodedLink = buildNativeEquipmentQrLink({ inv_no: 'INV-1' }, 'ITINVENT');
    expect(html).not.toContain('<script');
    expect(encodedLink).toContain('inv_no=INV-1');
  });

  it('keeps the full 42mm QR when the card has no model or serial', async () => {
    const html = await buildNativeEquipmentQrPrintHtml({ inv_no: 'INV-1', model_name: '', serial_no: '' });
    expect(html).toContain('width: 42mm');
  });

  it('elides overlong captions visually while the QR still encodes the full link', async () => {
    const html = await buildNativeEquipmentQrPrintHtml({
      inv_no: 'ИНВ-1234567890/АБВГД-очень-длинный-инвентарный-номер',
      model_name: 'УльтраДлиннаяМодельСистемногоБлокаКорпоративнойСерии',
      serial_no: 'SN-1234567890-ABCDEF-очень-длинный-серийный-номер',
    });
    expect(html).toContain('ИНВ-1234567890/АБВГД-очень-длинный-инвентарный-номер');
    expect(html).toContain('УльтраДлиннаяМодельСистемногоБлокаКорпоративнойСерии');
    expect(html).toContain('white-space: nowrap');
    expect(html).toContain('text-overflow: ellipsis');
  });

  it('escapes metadata so card fields cannot inject markup into the print job', async () => {
    const html = await buildNativeEquipmentQrPrintHtml(
      { inv_no: 'INV-1', model_name: '<script>alert(1)</script>', serial_no: 'SN"7&<x>' },
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('SN&quot;7&amp;&lt;x&gt;');
  });
});
