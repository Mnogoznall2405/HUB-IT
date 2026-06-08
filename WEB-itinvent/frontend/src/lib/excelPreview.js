import * as XLSX from 'xlsx';

export const EXCEL_PREVIEW_TEASER_MAX_ROWS = 18;
export const EXCEL_PREVIEW_TEASER_MAX_COLS = 10;
export const EXCEL_PREVIEW_FULL_MAX_ROWS = 250;
export const EXCEL_PREVIEW_FULL_MAX_COLS = 40;

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
  if (typeof blob?.arrayBuffer === 'function') return blob.arrayBuffer();
  if (typeof Response !== 'undefined') {
    return new Response(blob).arrayBuffer();
  }
  throw new Error('Excel preview blob cannot be read.');
};

export const parseExcelWorkbookFromBlob = async (blob) => {
  if (!blob) {
    throw new Error('Excel preview blob is missing.');
  }
  const buffer = await readBlobArrayBuffer(blob);
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    dense: false,
  });
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  const sheets = sheetNames.map((name, index) => {
    const worksheet = workbook.Sheets[name];
    const rows = worksheet
      ? XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false })
      : [];
    return {
      index,
      name: String(name || `Лист${index + 1}`),
      rows: Array.isArray(rows) ? rows : [],
    };
  });
  if (!sheets.length) {
    throw new Error('Excel workbook has no sheets.');
  }
  return { sheetNames, sheets };
};
