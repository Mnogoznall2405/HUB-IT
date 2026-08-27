import { APP_BRAND_NAME } from '../../lib/appBranding';
import { readFirst } from './databaseRecordModel';

const normalizeValue = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== '-' ? normalized : fallback;
};

const readValue = (equipment, keys, fallback = '') => (
  normalizeValue(readFirst(equipment, keys, ''), fallback)
);

export const buildEquipmentQrLabelContent = (equipment = {}) => ({
  brandName: APP_BRAND_NAME,
  invNo: readValue(equipment, ['INV_NO', 'inv_no'], 'Не указан'),
  serialNo: readValue(equipment, ['SERIAL_NO', 'serial_no'], 'Не указан'),
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Не удалось загрузить изображение: ${src}`));
  image.src = src;
});

const fitText = (context, text, maxWidth) => {
  const normalized = normalizeValue(text, '—');
  if (context.measureText(normalized).width <= maxWidth) return normalized;

  let shortened = normalized;
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
};

export const buildEquipmentQrLabelDataUrl = async ({
  equipment,
  qrDataUrl,
  logoUrl = '/favicon.png',
} = {}) => {
  const normalizedQrDataUrl = normalizeValue(qrDataUrl);
  if (!normalizedQrDataUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
    return '';
  }

  const content = buildEquipmentQrLabelContent(equipment);
  const qrImage = await loadImage(normalizedQrDataUrl);
  let logoImage = null;
  try {
    logoImage = await loadImage(logoUrl);
  } catch {
    // The label remains usable if the optional brand asset is temporarily unavailable.
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1000;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const logoSize = 92;
  const logoGap = 22;
  context.fillStyle = '#000000';
  context.font = '800 60px "Segoe UI", Arial, sans-serif';
  context.textAlign = 'left';
  const brandWidth = context.measureText(content.brandName).width;
  const brandGroupWidth = brandWidth + (logoImage ? logoSize + logoGap : 0);
  const brandGroupX = (canvas.width - brandGroupWidth) / 2;
  if (logoImage) {
    context.save();
    context.filter = 'brightness(0)';
    context.drawImage(logoImage, brandGroupX, 20, logoSize, logoSize);
    context.restore();
  }
  context.fillText(
    content.brandName,
    brandGroupX + (logoImage ? logoSize + logoGap : 0),
    91,
  );

  context.imageSmoothingEnabled = false;
  context.drawImage(qrImage, 155, 120, 690, 690);

  context.fillStyle = '#000000';
  context.textAlign = 'center';
  context.font = '600 23px "Segoe UI", Arial, sans-serif';
  context.fillText('СЕРИЙНЫЙ НОМЕР', 500, 872);
  context.font = '800 54px "Segoe UI", Arial, sans-serif';
  context.fillText(fitText(context, content.serialNo, 820), 500, 933);
  context.textAlign = 'left';

  return canvas.toDataURL('image/png');
};
