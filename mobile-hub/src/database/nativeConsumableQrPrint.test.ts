import { HUB_WEB_ORIGIN } from '../api/config';
import { parseInventoryQrPayload } from './nativeDatabaseModel';
import {
  buildNativeConsumableQrLink,
  buildNativeConsumableQrPrintHtml,
  CONSUMABLE_QR_BATCH_LIMIT,
} from './nativeConsumableQrPrint';

const item = (id: number, model = 'HP 12A') => ({ id, model_name: model });

describe('buildNativeConsumableQrLink', () => {
  it('encodes ITEMS.ID in the web /database link that the scanner parses back', () => {
    const link = buildNativeConsumableQrLink(item(4821), 'MSK-ITINVENT');
    expect(link.startsWith(`${HUB_WEB_ORIGIN}/database`)).toBe(true);
    expect(link).toContain('consumable=4821');
    expect(link).toContain('db_id=MSK-ITINVENT');
    expect(parseInventoryQrPayload(link)).toEqual({
      kind: 'consumable',
      itemId: 4821,
      inventoryNumber: '',
      databaseId: 'MSK-ITINVENT',
    });
  });

  it('distinguishes consumables whose legacy inv_no repeats', () => {
    // INV_NO is not unique for consumables; ITEMS.ID in the link is.
    const firstLink = buildNativeConsumableQrLink(item(11));
    const secondLink = buildNativeConsumableQrLink(item(22));
    expect(firstLink).not.toBe(secondLink);
    expect(parseInventoryQrPayload(firstLink)?.itemId).toBe(11);
    expect(parseInventoryQrPayload(secondLink)?.itemId).toBe(22);
  });

  it('rejects missing or non-positive IDs', () => {
    expect(() => buildNativeConsumableQrLink(item(0))).toThrow();
    expect(() => buildNativeConsumableQrLink(item(-3))).toThrow();
    expect(() => buildNativeConsumableQrLink(item(1.5))).toThrow();
  });
});

describe('buildNativeConsumableQrPrintHtml', () => {
  it('rejects empty and oversized batches', async () => {
    await expect(buildNativeConsumableQrPrintHtml([], '', 'a4')).rejects.toThrow();
    const overLimit = Array.from({ length: CONSUMABLE_QR_BATCH_LIMIT + 1 }, (_, index) => item(index + 1));
    await expect(buildNativeConsumableQrPrintHtml(overLimit, '', 'a4')).rejects.toThrow();
  });

  it('rejects duplicate IDs instead of silently dropping labels', async () => {
    await expect(buildNativeConsumableQrPrintHtml([item(11), item(11)], '', 'label')).rejects.toThrow();
  });

  it('renders a 56x50 roll label with a full-size QR when there is no model caption', async () => {
    const html = await buildNativeConsumableQrPrintHtml([{ id: 11, model_name: '' }], 'ITINVENT', 'label');
    expect(html).toContain('size: 56mm 50mm');
    expect(html).toContain('width:42mm');
    expect((html.match(/<svg/g) || []).length).toBe(1);
  });

  it('renders the 28x25 small roll format with a shrunk QR under a caption', async () => {
    const html = await buildNativeConsumableQrPrintHtml([item(11)], 'ITINVENT', 'label_small');
    expect(html).toContain('size: 28mm 25mm');
    expect(html).toContain('width:19mm');
    expect(html).toContain('HP 12A');
  });

  it('lays out an A4 grid with exactly one SVG per selected item', async () => {
    const html = await buildNativeConsumableQrPrintHtml([item(11), item(22)], 'ITINVENT', 'a4');
    expect(html).toContain('size: A4');
    expect(html).toContain('33.333mm');
    expect((html.match(/<svg/g) || []).length).toBe(2);
  });

  it('escapes model captions so card metadata cannot inject markup', async () => {
    const html = await buildNativeConsumableQrPrintHtml(
      [item(11, '<script>alert(1)</script>')],
      'ITINVENT',
      'label',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
