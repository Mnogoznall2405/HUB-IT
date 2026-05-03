import QRCode from 'qrcode';

const readFirst = (data, keys, fallback = '') => {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
};

export const buildEquipmentQrText = (item) => {
  const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
  const serialNo = String(readFirst(item, ['SERIAL_NO', 'serial_no'], '') || '').trim();
  const modelName = String(readFirst(item, ['MODEL_NAME', 'model_name'], '') || '').trim();
  const partNo = String(readFirst(item, ['PART_NO', 'part_no'], '') || '').trim();

  return [
    `INV_NO: ${invNo || '-'}`,
    `SERIAL_NO: ${serialNo || '-'}`,
    `MODEL: ${modelName || '-'}`,
    `PART_NO: ${partNo || '-'}`,
  ].join('\n');
};

export const parseInvNoFromQrText = (qrText) => {
  const text = String(qrText || '').trim();
  if (!text) return null;

  const invNoMatch = text.match(/^INV_NO:\s*(.+)$/m);
  if (invNoMatch) {
    const invNo = invNoMatch[1].trim();
    return invNo && invNo !== '-' ? invNo : null;
  }

  if (text.includes('\n')) return null;
  return text;
};

export const buildEquipmentQrDataUrl = async (payload) => {
  const text = String(payload || '').trim();
  if (!text) return '';

  return QRCode.toDataURL(text, {
    width: 360,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
};

export const getQrScannerErrorMessage = (err) => {
  const name = String(err?.name || '').trim();
  const rawMessage = String(err?.message || err || '').trim();

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Доступ к камере запрещён. Разрешите доступ к камере в браузере.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Камера не найдена.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Камера уже используется другим приложением или вкладкой.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'Камера не поддерживает запрошенный режим. Попробуйте другую камеру.';
  }
  if (rawMessage) {
    return `Не удалось запустить камеру: ${rawMessage}`;
  }
  return 'Не удалось запустить камеру.';
};

export const isIgnorableQrFrameError = (errorMessage = '') => {
  const message = String(errorMessage || '');
  return (
    message.includes('No MultiFormat Readers')
    || message.includes('NotFoundException')
    || message.includes('QR code parse error')
    || message.includes('undefined')
  );
};

export const getQrboxDimensions = (viewfinderWidth, viewfinderHeight) => {
  const minEdge = Math.min(Number(viewfinderWidth) || 0, Number(viewfinderHeight) || 0);
  const fallbackSize = 220;
  const size = minEdge > 0
    ? Math.max(140, Math.min(260, Math.floor(minEdge * 0.72)))
    : fallbackSize;
  return { width: size, height: size };
};

export const stopQrScannerInstance = async (scanner) => {
  if (!scanner) return;

  try {
    if (typeof scanner.stop === 'function') {
      await scanner.stop();
    }
  } catch (err) {
    const message = String(err?.message || err || '');
    if (!/not running|not started|already stopped|Cannot stop/i.test(message)) {
      console.warn('Ошибка при остановке сканера:', err);
    }
  }

  try {
    if (typeof scanner.clear === 'function') {
      scanner.clear();
    }
  } catch (err) {
    console.warn('Ошибка при очистке сканера:', err);
  }
};
