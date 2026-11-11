const QR_OPTIONS = {
  width: 360,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#000000', light: '#ffffff' },
};

export async function buildQrDataUrl(text) {
  const target = String(text || '').trim();
  if (!target) return '';
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(target, QR_OPTIONS);
}
