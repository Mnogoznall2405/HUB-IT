// Minimal typing for the bundled `qrcode` 1.5.4 (it ships no declarations).
// Only the surface used by nativeEquipmentQrPrint is declared.
declare module 'qrcode' {
  const QRCode: {
    toString(
      text: string,
      options?: {
        type?: 'svg' | 'terminal' | 'utf8';
        width?: number;
        margin?: number;
        errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      },
    ): Promise<string>;
  };
  export default QRCode;
}
