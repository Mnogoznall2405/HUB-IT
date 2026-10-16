import { APP_BRAND_NAME } from '../../lib/appBranding';
import { readFirst } from './databaseRecordModel';

export const EQUIPMENT_QR_LABEL_WIDTH_MM = 56;
export const EQUIPMENT_QR_LABEL_HEIGHT_MM = 50;
export const EQUIPMENT_QR_CODE_SIZE_MM = 42;
// Малая этикетка: ровно вдвое меньше по каждой стороне (для мелкой техники).
export const EQUIPMENT_QR_SMALL_LABEL_WIDTH_MM = 28;
export const EQUIPMENT_QR_SMALL_LABEL_HEIGHT_MM = 25;
const SMALL_LABEL_QR_SIZE_PX = 740;
const SMALL_LABEL_QR_TOP_PX = 195;

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
  modelName: readValue(equipment, ['MODEL_NAME', 'model_name'], 'Не указана'),
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
  canvasWidth = 1000,
  compact = false,
  roll = false,
} = {}) => {
  const normalizedQrDataUrl = normalizeValue(qrDataUrl);
  if (!normalizedQrDataUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
    return '';
  }

  const qrImage = await loadImage(normalizedQrDataUrl);
  let logoImage = null;
  if (!qrOnly && logoUrl) {
    try {
      logoImage = await loadImage(logoUrl);
    } catch {
      // The label remains usable if the optional brand asset is temporarily unavailable.
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = 1000;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (qrOnly) {
    context.imageSmoothingEnabled = false;
    const qrBottomText = normalizeValue(bottomValue);
    if (roll) {
      // Рулонная этикетка (56 × 50 или 28 × 25 мм): QR по центру, модель под ним.
      const rollCenterX = canvas.width / 2;
      const rollTextWidth = canvas.width - 80;
      if (!qrBottomText) {
        context.drawImage(qrImage, rollCenterX - 460, 40, 920, 920);
        return canvas.toDataURL('image/png');
      }
      const rollQrSize = compact ? 780 : 800;
      context.drawImage(qrImage, rollCenterX - rollQrSize / 2, 20, rollQrSize, rollQrSize);
      context.fillStyle = '#000000';
      context.textAlign = 'center';
      const rollLine = setFittedTextFont(context, qrBottomText, {
        maxWidth: rollTextWidth,
        maxFontSize: compact ? 130 : 96,
        minFontSize: compact ? 60 : 36,
      });
      context.fillText(rollLine, rollCenterX, compact ? 965 : 955, rollTextWidth);
      context.textAlign = 'left';
      return canvas.toDataURL('image/png');
    }
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

  if (compact) {
    // Малая этикетка: без бренда и подписей, модель в 1-2 строки крупнее,
    // QR почти во всю высоту, серийный номер под ним.
    const compactCenterX = canvas.width / 2;
    const compactTextWidth = canvas.width - 80;
    context.fillStyle = '#000000';
    context.textAlign = 'center';
    const modelText = normalizeValue(topValue, '—');
    const oneLine = setFittedTextFont(context, modelText, {
      maxWidth: compactTextWidth,
      maxFontSize: 84,
      minFontSize: 56,
    });
    if (context.measureText(oneLine).width <= compactTextWidth) {
      context.fillText(oneLine, compactCenterX, 130, compactTextWidth);
    } else {
      const words = modelText.split(/\s+/);
      let splitAt = Math.ceil(words.length / 2);
      let best = Infinity;
      for (let index = 1; index < words.length; index += 1) {
        const diff = Math.abs(words.slice(0, index).join(' ').length - words.slice(index).join(' ').length);
        if (diff < best) {
          best = diff;
          splitAt = index;
        }
      }
      const lines = words.length > 1
        ? [words.slice(0, splitAt).join(' '), words.slice(splitAt).join(' ')]
        : [modelText];
      const lineBaselines = lines.length > 1 ? [88, 172] : [130];
      // Один шрифт на обе строки: самый крупный, при котором влезает длиннейшая.
      let lineSize = 70;
      while (lineSize > 36) {
        context.font = `800 ${lineSize}px "Segoe UI", Arial, sans-serif`;
        if (lines.every((line) => context.measureText(line).width <= compactTextWidth)) break;
        lineSize -= 2;
      }
      context.font = `800 ${lineSize}px "Segoe UI", Arial, sans-serif`;
      lines.forEach((line, lineIndex) => {
        context.fillText(line, compactCenterX, lineBaselines[lineIndex], compactTextWidth);
      });
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(
      qrImage,
      compactCenterX - SMALL_LABEL_QR_SIZE_PX / 2,
      SMALL_LABEL_QR_TOP_PX,
      SMALL_LABEL_QR_SIZE_PX,
      SMALL_LABEL_QR_SIZE_PX,
    );
    const serialText = setFittedTextFont(context, bottomValue, {
      maxWidth: compactTextWidth,
      maxFontSize: 60,
      minFontSize: 36,
    });
    context.fillText(serialText, compactCenterX, 985, compactTextWidth);
    context.textAlign = 'left';
    return canvas.toDataURL('image/png');
  }

  const logoSize = 62;
  const logoGap = 14;
  const centerX = canvas.width / 2;
  const textWidth = canvas.width - 120;
  context.fillStyle = '#000000';
  context.font = '800 62px "Segoe UI", Arial, sans-serif';
  context.textAlign = 'left';
  const brandWidth = context.measureText(brandName).width;
  const brandGroupWidth = brandWidth + (logoImage ? logoSize + logoGap : 0);
  const brandGroupX = (canvas.width - brandGroupWidth) / 2;
  if (logoImage) {
    context.save();
    context.filter = 'brightness(0)';
    context.drawImage(logoImage, brandGroupX, 4, logoSize, logoSize);
    context.restore();
  }
  context.fillText(
    brandName,
    brandGroupX + (logoImage ? logoSize + logoGap : 0),
    61,
  );

  context.textAlign = 'center';
  context.font = '600 18px "Segoe UI", Arial, sans-serif';
  if (topCaption) context.fillText(topCaption, centerX, 86);
  const topText = setFittedTextFont(context, topValue, {
    maxWidth: textWidth,
    maxFontSize: 60,
    minFontSize: 24,
  });
  context.fillText(topText, centerX, 118, textWidth);

  context.imageSmoothingEnabled = false;
  const qrSize = EQUIPMENT_QR_CODE_SIZE_MM * canvas.height / EQUIPMENT_QR_LABEL_HEIGHT_MM;
  context.drawImage(qrImage, centerX - qrSize / 2, 125, qrSize, qrSize);

  context.fillStyle = '#000000';
  context.textAlign = 'center';
  context.font = '600 18px "Segoe UI", Arial, sans-serif';
  if (bottomCaption) context.fillText(bottomCaption, centerX, 938);
  const bottomText = setFittedTextFont(context, bottomValue, {
    maxWidth: textWidth,
    maxFontSize: 40,
    minFontSize: 24,
  });
  // Canvas keeps the complete value and only condenses horizontally as a last resort.
  context.fillText(bottomText, centerX, 985, textWidth);
  context.textAlign = 'left';

  return canvas.toDataURL('image/png');
};

export const buildEquipmentQrLabelDataUrl = async ({
  equipment,
  qrDataUrl,
  compact = false,
} = {}) => {
  const content = buildEquipmentQrLabelContent(equipment);
  return buildQrLabelDataUrl({
    qrDataUrl,
    logoUrl: '',
    brandName: content.brandName,
    topCaption: '',
    topValue: content.modelName,
    bottomCaption: '',
    bottomValue: content.serialNo,
    canvasWidth: 1000 * EQUIPMENT_QR_LABEL_WIDTH_MM / EQUIPMENT_QR_LABEL_HEIGHT_MM,
    compact,
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
// `format`: 'label' (56 × 50 мм) и 'label_small' (28 × 25 мм) — те же размеры, что у
// оборудования; иначе квадратная этикетка для ячейки сетки на листе A4.
export const buildConsumableQrLabelDataUrl = async ({ consumable, qrDataUrl, format = 'a4' } = {}) => {
  const roll = format === 'label' || format === 'label_small';
  return buildQrLabelDataUrl({
    qrDataUrl,
    qrOnly: true,
    bottomValue: readValue(consumable || {}, ['MODEL_NAME', 'model_name'], ''),
    ...(roll ? {
      roll: true,
      compact: format === 'label_small',
      canvasWidth: 1000 * EQUIPMENT_QR_LABEL_WIDTH_MM / EQUIPMENT_QR_LABEL_HEIGHT_MM,
    } : {}),
  });
};
