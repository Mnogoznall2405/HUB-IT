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

const setFittedTextFont = (context, text, {
  maxWidth,
  maxFontSize,
  minFontSize,
  fontWeight = 800,
}) => {
  const normalized = normalizeValue(text, '—');
  let fontSize = maxFontSize;
  while (fontSize > minFontSize) {
    context.font = `${fontWeight} ${fontSize}px "Segoe UI", Arial, sans-serif`;
    if (context.measureText(normalized).width <= maxWidth) return normalized;
    fontSize -= 2;
  }
  context.font = `${fontWeight} ${minFontSize}px "Segoe UI", Arial, sans-serif`;
  return normalized;
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

  const logoSize = 76;
  const logoGap = 22;
  context.fillStyle = '#000000';
  context.font = '800 56px "Segoe UI", Arial, sans-serif';
  context.textAlign = 'left';
  const brandWidth = context.measureText(content.brandName).width;
  const brandGroupWidth = brandWidth + (logoImage ? logoSize + logoGap : 0);
  const brandGroupX = (canvas.width - brandGroupWidth) / 2;
  if (logoImage) {
    context.save();
    context.filter = 'brightness(0)';
    context.drawImage(logoImage, brandGroupX, 32, logoSize, logoSize);
    context.restore();
  }
  context.fillText(
    content.brandName,
    brandGroupX + (logoImage ? logoSize + logoGap : 0),
    91,
  );

  context.textAlign = 'center';
  context.font = '600 24px "Segoe UI", Arial, sans-serif';
  context.fillText('Инв. №', 500, 135);
  const invNo = setFittedTextFont(context, content.invNo, {
    maxWidth: 880,
    maxFontSize: 62,
    minFontSize: 30,
  });
  context.fillText(invNo, 500, 195, 880);

  context.imageSmoothingEnabled = false;
  context.drawImage(qrImage, 200, 220, 600, 600);

  context.fillStyle = '#000000';
  context.textAlign = 'center';
  context.font = '600 24px "Segoe UI", Arial, sans-serif';
  context.fillText('Серийный номер', 500, 862);
  const serialNo = setFittedTextFont(context, content.serialNo, {
    maxWidth: 880,
    maxFontSize: 54,
    minFontSize: 24,
  });
  // Canvas keeps the complete value and only condenses horizontally as a last resort.
  context.fillText(serialNo, 500, 936, 880);

  // A 0.15 mm inner frame keeps every 50x50 mm label identical and marks the cut line.
  context.strokeStyle = '#000000';
  context.lineWidth = 3;
  context.strokeRect(1.5, 1.5, 997, 997);
  context.textAlign = 'left';

  return canvas.toDataURL('image/png');
};
