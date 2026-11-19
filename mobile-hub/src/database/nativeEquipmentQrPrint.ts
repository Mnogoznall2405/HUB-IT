import QRCode from 'qrcode';
import { HUB_WEB_ORIGIN } from '../api/config';
import type { EquipmentRecord } from '../api/databaseApi';

// Parity with the web label (equipmentQrLabel.js): 56×50 mm roll label with
// a ~42 mm QR code; the encoded link is the web /database URL the native
// scanner already parses (parseInventoryQrPayload).
const QR_LABEL_WIDTH_MM = 56;
const QR_LABEL_HEIGHT_MM = 50;
const QR_CODE_SIZE_MM = 42;

export function buildNativeEquipmentQrLink(
  equipment: Pick<EquipmentRecord, 'inv_no'>,
  databaseId = '',
): string {
  const invNo = String(equipment?.inv_no || '').trim();
  if (!invNo) throw new Error('У оборудования отсутствует инвентарный номер');
  const url = new URL('/database', HUB_WEB_ORIGIN);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Адрес HUB-IT не подходит для QR-ссылки');
  }
  url.searchParams.set('inv_no', invNo);
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

export async function buildNativeEquipmentQrPrintHtml(
  equipment: Pick<EquipmentRecord, 'inv_no' | 'model_name' | 'serial_no'>,
  databaseId = '',
): Promise<string> {
  const link = buildNativeEquipmentQrLink(equipment, databaseId);
  const svg = await QRCode.toString(link, {
    type: 'svg',
    width: 360,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  // Only the qrcode-generated SVG is interpolated raw; every equipment field
  // is escaped so card metadata can never inject markup into the print job.
  const invNo = escapeHtml(String(equipment.inv_no || '').trim());
  const model = escapeHtml(String(equipment.model_name || '').trim());
  const serial = escapeHtml(String(equipment.serial_no || '').trim());
  const metaLines = [
    model ? `<div class="meta">${model}</div>` : '',
    serial ? `<div class="meta">SN: ${serial}</div>` : '',
  ].join('');
  // Fit the 50mm page: each metadata line shrinks the QR so nothing clips.
  const qrSizeMm = model && serial ? 39 : model || serial ? 41 : QR_CODE_SIZE_MM;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: ${QR_LABEL_WIDTH_MM}mm ${QR_LABEL_HEIGHT_MM}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: ${QR_LABEL_WIDTH_MM}mm; height: ${QR_LABEL_HEIGHT_MM}mm; background: #ffffff; color: #000000; font-family: 'Segoe UI', Arial, sans-serif; }
  .label { width: ${QR_LABEL_WIDTH_MM}mm; height: ${QR_LABEL_HEIGHT_MM}mm; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1mm; }
  .qr { width: ${qrSizeMm}mm; height: ${qrSizeMm}mm; }
  .qr svg { width: ${qrSizeMm}mm; height: ${qrSizeMm}mm; display: block; }
  /* Captions stay on one line so they never push past the 50mm page; very
     long values are elided visually, while the full inv_no stays scannable in
     the encoded QR link. */
  .inv, .meta { display: block; width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .inv { margin-top: 0.6mm; font-size: 8.5pt; font-weight: 700; line-height: 1.15; text-align: center; }
  .meta { font-size: 5.5pt; line-height: 1.15; text-align: center; max-width: 52mm; }
</style>
</head>
<body>
  <div class="label">
    <div class="qr">${svg}</div>
    <div class="inv">Инв. № ${invNo}</div>
    ${metaLines}
  </div>
</body>
</html>`;
}
