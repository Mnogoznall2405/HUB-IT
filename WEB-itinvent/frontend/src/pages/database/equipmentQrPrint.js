import { toInvNo } from './equipmentModel';
import { buildEquipmentQrLabelDataUrl } from './equipmentQrLabel';
import { buildEquipmentQrDataUrl, buildEquipmentQrLink } from './qrModel';

const uniqueValues = (values) => Array.from(new Set(
  (values || []).map((value) => String(value || '').trim()).filter(Boolean)
));

export async function buildEquipmentQrPrintBatch({
  items = [],
  databaseId = '',
  origin = typeof window !== 'undefined' ? window.location.origin : '',
  skippedInvNos = [],
} = {}) {
  const results = [];
  for (const item of items || []) {
    const invNo = toInvNo(item);
    if (!invNo) {
      results.push({ skippedInvNo: '' });
      continue;
    }

    const link = buildEquipmentQrLink(item, { databaseId, origin });
    if (!link) {
      results.push({ skippedInvNo: invNo });
      continue;
    }

    try {
      const qrDataUrl = await buildEquipmentQrDataUrl(link);
      const labelDataUrl = await buildEquipmentQrLabelDataUrl({ equipment: item, qrDataUrl });
      results.push(labelDataUrl
        ? { label: { invNo, dataUrl: labelDataUrl } }
        : { skippedInvNo: invNo });
    } catch (error) {
      console.error(`Failed to prepare QR label ${invNo}:`, error);
      results.push({ skippedInvNo: invNo });
    }
  }

  return {
    labels: results.map((result) => result.label).filter(Boolean),
    skippedInvNos: uniqueValues([
      ...skippedInvNos,
      ...results.map((result) => result.skippedInvNo),
    ]),
  };
}

export function formatQrLabelCount(value) {
  const count = Math.max(0, Number(value) || 0);
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} этикетка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} этикетки`;
  }
  return `${count} этикеток`;
}
