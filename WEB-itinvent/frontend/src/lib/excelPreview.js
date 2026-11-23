export const EXCEL_PREVIEW_TEASER_MAX_ROWS = 18;
export const EXCEL_PREVIEW_TEASER_MAX_COLS = 10;
export const EXCEL_PREVIEW_FULL_MAX_ROWS = 250;
export const EXCEL_PREVIEW_FULL_MAX_COLS = 40;

// HIGH-07: ограничения разбора ненадёжных XLSX (почта/Мои файлы/share-ссылки).
export const EXCEL_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const EXCEL_PREVIEW_MAX_SHEETS = 50;
export const EXCEL_PREVIEW_MAX_ROWS_PER_SHEET = 5000;
export const EXCEL_PREVIEW_MAX_COLS_PER_SHEET = 512;

export const columnLetter = (index = 0) => {
  let value = Number(index) + 1;
  if (!Number.isFinite(value) || value <= 0) return 'A';
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

export const formatExcelCellValue = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return value.toLocaleDateString('ru-RU');
  }
  return String(value);
};

export const sliceExcelRows = (rows = [], { maxRows, maxCols } = {}) => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const rowLimit = Math.max(1, Number(maxRows || sourceRows.length || 1));
  const colLimit = Math.max(1, Number(maxCols || 1));
  return sourceRows.slice(0, rowLimit).map((row) => {
    const cells = Array.isArray(row) ? row : [];
    const normalized = cells.slice(0, colLimit).map((cell) => formatExcelCellValue(cell));
    while (normalized.length < colLimit) normalized.push('');
    return normalized;
  });
};

const readBlobArrayBuffer = async (blob) => {
  if (blob instanceof ArrayBuffer) return blob;
  if (ArrayBuffer.isView(blob)) {
    return blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  }
  if (typeof blob?.arrayBuffer === 'function') return blob.arrayBuffer();
  if (typeof Response !== 'undefined') {
    return new Response(blob).arrayBuffer();
  }
  throw new Error('Excel preview blob cannot be read.');
};

const decodeSheetRange = (XLSX, worksheet) => (worksheet?.['!ref']
  ? XLSX.utils.decode_range(worksheet['!ref'])
  : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } });

const clampSheetRange = (range) => ({
  s: { r: range.s.r, c: range.s.c },
  e: {
    r: Math.min(range.e.r, range.s.r + EXCEL_PREVIEW_MAX_ROWS_PER_SHEET - 1),
    c: Math.min(range.e.c, range.s.c + EXCEL_PREVIEW_MAX_COLS_PER_SHEET - 1),
  },
});

const workbookToPreview = (XLSX, workbook) => {
  const allSheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  const sheetNames = allSheetNames.slice(0, EXCEL_PREVIEW_MAX_SHEETS);
  const sheets = sheetNames.map((name, index) => {
    const worksheet = workbook.Sheets[name];
    const sheetRange = decodeSheetRange(XLSX, worksheet);
    const rows = worksheet
      ? XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          raw: false,
          range: clampSheetRange(sheetRange),
        })
      : [];
    return {
      index,
      name: String(name || `Лист${index + 1}`),
      rows: Array.isArray(rows) ? rows : [],
      totalRows: sheetRange.e.r - sheetRange.s.r + 1,
    };
  });
  if (!sheets.length) {
    throw new Error('Excel workbook has no sheets.');
  }
  return { sheetNames, sheets };
};

export const parseExcelWorkbookFromBlob = async (blob) => {
  if (!blob) {
    throw new Error('Excel preview blob is missing.');
  }
  const buffer = await readBlobArrayBuffer(blob);
  if (buffer.byteLength > EXCEL_PREVIEW_MAX_BYTES) {
    throw new Error('Excel workbook exceeds the preview size limit.');
  }
  const XLSX = await import('xlsx-js-style');
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    dense: false,
    sheetRows: EXCEL_PREVIEW_MAX_ROWS_PER_SHEET,
  });
  return workbookToPreview(XLSX, workbook);
};

/**
 * CSV/TSV -> workbook preview. Decoding happens before parsing so legacy
 * cp1251 CSV files keep their Cyrillic content intact.
 */
export const parseCsvTextToWorkbook = async (text, { maxRows = EXCEL_PREVIEW_MAX_ROWS_PER_SHEET } = {}) => {
  const XLSX = await import('xlsx-js-style');
  const workbook = XLSX.read(String(text || ''), {
    type: 'string',
    sheetRows: maxRows,
  });
  return workbookToPreview(XLSX, workbook);
};
