/**
 * Infer whether a downloaded document can be shown in DocumentPreviewDialog.
 * Acts are often stored as DOC/DOCX/images with wrong or generic content-types;
 * sniffing the first bytes avoids feeding non-PDF blobs into pdf.js.
 */

export function fileNameFromContentDisposition(headerValue = '', fallback = '') {
  const text = String(headerValue || '');
  const utfMatch = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim());
    } catch {
      return utfMatch[1].trim();
    }
  }
  const plainMatch = text.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1]?.trim() || fallback;
}

function extensionOf(fileName = '') {
  const name = String(fileName || '').toLowerCase();
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  return name.slice(idx + 1);
}

export function sniffBytesKind(bytes) {
  if (!bytes || bytes.length < 4) return '';
  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf';
  }
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image';
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image';
  }
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image';
  }
  // OLE Compound Document (old .doc / .xls)
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return 'ole';
  }
  // ZIP container (.docx / .xlsx / .odt …)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return 'zip';
  }
  return '';
}

export async function sniffBlobKind(blob) {
  if (!(blob instanceof Blob) || blob.size <= 0) return '';
  try {
    const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    return sniffBytesKind(header);
  } catch {
    return '';
  }
}

/**
 * @returns {{ kind: 'pdf'|'unsupported', error: string }}
 */
export function resolveDocumentPreviewKind({
  contentType = '',
  fileName = '',
  sniff = '',
} = {}) {
  const mime = String(contentType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  const ext = extensionOf(name);
  const sniffed = String(sniff || '').toLowerCase();

  // Byte signature wins over a generic/wrong Content-Type.
  if (sniffed === 'pdf' || mime.includes('pdf') || ext === 'pdf') {
    return { kind: 'pdf', error: '' };
  }

  if (
    mime.includes('spreadsheet')
    || mime.includes('excel')
    || ext === 'xlsx'
    || ext === 'xls'
  ) {
    return {
      kind: 'unsupported',
      error: 'Excel-файл нельзя открыть как PDF-предпросмотр. Скачайте оригинал.',
    };
  }

  if (
    sniffed === 'ole'
    || ext === 'doc'
    || ext === 'docx'
    || ext === 'rtf'
    || mime.includes('msword')
    || mime.includes('wordprocessingml')
    || mime.includes('rtf')
  ) {
    return {
      kind: 'unsupported',
      error: 'Этот акт сохранён как Word/Office-файл. Встроенный предпросмотр поддерживает только PDF — скачайте оригинал.',
    };
  }

  if (sniffed === 'zip') {
    return {
      kind: 'unsupported',
      error: 'Файл похож на Office-документ. Встроенный предпросмотр поддерживает только PDF — скачайте оригинал.',
    };
  }

  if (
    sniffed === 'image'
    || mime.startsWith('image/')
    || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(ext)
  ) {
    return {
      kind: 'unsupported',
      error: 'Файл акта — изображение. Сейчас предпросмотр открывает только PDF; скачайте оригинал.',
    };
  }

  if (!mime || mime.includes('octet-stream') || mime.startsWith('text/')) {
    return {
      kind: 'unsupported',
      error: 'Не удалось определить формат файла акта для предпросмотра. Скачайте оригинал.',
    };
  }

  return {
    kind: 'unsupported',
    error: `Формат «${ext || mime}» не поддерживается в предпросмотре. Скачайте оригинал.`,
  };
}
