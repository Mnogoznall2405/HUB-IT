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

export const buildQrLabelDataUrl = async ({
  qrDataUrl,
  logoUrl = '/favicon.png',
  brandName = APP_BRAND_NAME,
  topCaption = 'Инв. №',
  topValue = '',
  bottomCaption = 'Серийный номер',
  bottomValue = '',
  qrOnly = false,
} = {}) => {
  const normalizedQrDataUrl = normalizeValue(qrDataUrl);
  if (!normalizedQrDataUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
    return '';
  }

  const qrImage = await loadImage(normalizedQrDataUrl);
  let logoImage = null;
  if (!qrOnly) {
    try {
      logoImage = await loadImage(logoUrl);
    } catch {
      // The label remains usable if the optional brand asset is temporarily unavailable.
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1000;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (qrOnly) {
    context.imageSmoothingEnabled = false;
    const qrBottomText = normalizeValue(bottomValue);
    if (!qrBottomText) {
      context.drawImage(qrImage, 40, 40, 920, 920);
      return canvas.toDataURL('image/png');
    }
    context.drawImage(qrImage, 60, 20, 820, 820);
    context.fillStyle = '#000000';
    context.textAlign = 'center';
    const qrBottomLine = setFittedTextFont(context, qrBottomText, {
      maxWidth: 940,
      maxFontSize: 80,
      minFontSize: 26,
    });
    context.fillText(qrBottomLine, 500, 945, 940);
    context.textAlign = 'left';
    return canvas.toDataURL('image/png');
  }

  const logoSize = 76;
  const logoGap = 22;
  context.fillStyle = '#000000';
  context.font = '800 56px "Segoe UI", Arial, sans-serif';
  context.textAlign = 'left';
  const brandWidth = context.measureText(brandName).width;
  const brandGroupWidth = brandWidth + (logoImage ? logoSize + logoGap : 0);
  const brandGroupX = (canvas.width - brandGroupWidth) / 2;
  if (logoImage) {
    context.save();
    context.filter = 'brightness(0)';
    context.drawImage(logoImage, brandGroupX, 32, logoSize, logoSize);
    context.restore();
  }
  context.fillText(
    brandName,
    brandGroupX + (logoImage ? logoSize + logoGap : 0),
    91,
  );

  context.textAlign = 'center';
  context.font = '600 24px "Segoe UI", Arial, sans-serif';
  context.fillText(topCaption, 500, 135);
  const topText = setFittedTextFont(context, topValue, {
    maxWidth: 880,
    maxFontSize: 62,
    minFontSize: 30,
  });
  context.fillText(topText, 500, 195, 880);

  context.imageSmoothingEnabled = false;
  context.drawImage(qrImage, 200, 220, 600, 600);

  context.fillStyle = '#000000';
  context.textAlign = 'center';
  context.font = '600 24px "Segoe UI", Arial, sans-serif';
  context.fillText(bottomCaption, 500, 862);
  const bottomText = setFittedTextFont(context, bottomValue, {
    maxWidth: 880,
    maxFontSize: 54,
    minFontSize: 24,
  });
  // Canvas keeps the complete value and only condenses horizontally as a last resort.
  context.fillText(bottomText, 500, 936, 880);

  // A 0.15 mm inner frame keeps every 50x50 mm label identical and marks the cut line.
  context.strokeStyle = '#000000';
  context.lineWidth = 3;
  context.strokeRect(1.5, 1.5, 997, 997);
  context.textAlign = 'left';

  return canvas.toDataURL('image/png');
};

export const buildEquipmentQrLabelDataUrl = async ({
  equipment,
  qrDataUrl,
  logoUrl = '/favicon.png',
} = {}) => {
  const content = buildEquipmentQrLabelContent(equipment);
  return buildQrLabelDataUrl({
    qrDataUrl,
    logoUrl,
    brandName: content.brandName,
    topCaption: 'Инв. №',
    topValue: content.invNo,
    bottomCaption: 'Серийный номер',
    bottomValue: content.serialNo,
  });
};

export const buildConsumableQrLabelContent = (consumable = {}) => ({
  brandName: APP_BRAND_NAME,
  typeName: readValue(consumable, ['TYPE_NAME', 'type_name'], 'Расходник'),
  modelName: readValue(consumable, ['MODEL_NAME', 'model_name'], ''),
  invNo: readValue(consumable, ['INV_NO', 'inv_no'], '—'),
  qrOnly: true,
});

// Consumable label = QR + model caption on the sticker: no frame, no brand —
// the model line distinguishes identical-looking QRs across shelves.
export const buildConsumableQrLabelDataUrl = async ({ consumable, qrDataUrl } = {}) =>
  buildQrLabelDataUrl({
    qrDataUrl,
    qrOnly: true,
    bottomValue: readValue(consumable || {}, ['MODEL_NAME', 'model_name'], ''),
  });
