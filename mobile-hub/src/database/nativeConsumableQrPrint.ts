import QRCode from 'qrcode';
import { HUB_WEB_ORIGIN } from '../api/config';
import type { ConsumableRecord } from '../api/databaseApi';

export type ConsumableQrPrintFormat = 'label' | 'label_small' | 'a4';

// Web parity (useConsumableQrLabel.js): roll labels 56x50 and 28x25 mm,
// A4 as a fixed 6x6 grid. The same cap bounds roll batches so a bulk job
// can never produce an unbounded print document.
export const CONSUMABLE_QR_BATCH_LIMIT = 36;

export function buildNativeConsumableQrLink(
  item: Pick<ConsumableRecord, 'id'>,
  databaseId = '',
): string {
  // Legacy consumable INV_NO can repeat — the QR keys by ITEMS.ID.
  if (!Number.isSafeInteger(item.id) || item.id <= 0) throw new Error('ID расходника недоступен');
  const url = new URL('/database', HUB_WEB_ORIGIN);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Адрес HUB-IT не подходит для QR-ссылки');
  }
  url.searchParams.set('consumable', String(item.id));
  if (databaseId.trim()) url.searchParams.set('db_id', databaseId.trim());
  return url.toString();
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelCss(format: ConsumableQrPrintFormat): string {
  if (format === 'a4') {
    return `@page { size: A4; margin: 5mm; }
  .grid { display: grid; grid-template-columns: repeat(6, 33.333mm); grid-auto-rows: 47.833mm; }
  .label { width: 33.333mm; height: 47.833mm; padding: 1mm; }
  .cap { font-size: 6pt; }`;
  }
  if (format === 'label_small') {
    return `@page { size: 28mm 25mm; margin: 0; }
  body { width: 28mm; height: 25mm; }
  .label { width: 28mm; height: 25mm; padding: 0.5mm; }
  .label:not(:last-child) { break-after: page; }
  .cap { font-size: 4pt; }`;
  }
  return `@page { size: 56mm 50mm; margin: 0; }
  body { width: 56mm; height: 50mm; }
  .label { width: 56mm; height: 50mm; padding: 1mm; }
  .label:not(:last-child) { break-after: page; }
  .cap { font-size: 6pt; }`;
}

export async function buildNativeConsumableQrPrintHtml(
  items: readonly Pick<ConsumableRecord, 'id' | 'model_name'>[],
  databaseId: string,
  format: ConsumableQrPrintFormat,
): Promise<string> {
  if (!items.length) throw new Error('Нет расходников для печати QR.');
  if (items.length > CONSUMABLE_QR_BATCH_LIMIT) {
    throw new Error(`Можно напечатать не больше ${CONSUMABLE_QR_BATCH_LIMIT} QR за раз.`);
  }
  const seen = new Set<number>();
  const labels: string[] = [];
  for (const item of items) {
    if (!Number.isSafeInteger(item.id) || item.id <= 0) throw new Error('ID расходника недоступен');
    if (seen.has(item.id)) throw new Error('В списке есть повторяющийся расходник.');
    seen.add(item.id);
    const link = buildNativeConsumableQrLink(item, databaseId);
    const svg = await QRCode.toString(link, {
      type: 'svg',
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    // Only the qrcode-generated SVG is interpolated raw; the caption is always
    // HTML-escaped and visually bounded to one line so it cannot overflow the
    // label — the full ID stays scannable inside the encoded link.
    const model = escapeHtml(String(item.model_name || '').trim());
    const qrMm = format === 'a4' ? 29 : format === 'label_small' ? (model ? 19 : 22) : (model ? 40 : 42);
    labels.push(
      `<div class="label"><div class="qr" style="width:${qrMm}mm;height:${qrMm}mm">${svg}</div>` +
      (model ? `<div class="cap">${model}</div>` : '') +
      `</div>`,
    );
  }
  const body = format === 'a4' ? `<div class="grid">${labels.join('')}</div>` : labels.join('');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #ffffff; color: #000000; font-family: 'Segoe UI', Arial, sans-serif; }
  ${labelCss(format)}
  .label { display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .cap { display: block; width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: center; line-height: 1.2; }
</style>
</head>
<body>${body}</body>
</html>`;
}
