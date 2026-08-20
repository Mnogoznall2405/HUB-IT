import { readFirst } from './databaseRecordModel';

const GAP_COLUMNS = 1;
const MAX_COL_WIDTH = 56;

function displayText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function hubItemDatabaseMeta(item) {
  const databaseId = String(item?.hub_db_id || item?.HUB_DB_ID || '').trim();
  const dbName = String(item?.hub_db_name || item?.HUB_DB_NAME || databaseId || '').trim();
  const isCurrentDb = Boolean(item?.is_current_db ?? item?.IS_CURRENT_DB);
  return { databaseId, dbName, isCurrentDb };
}

export function shouldShowHubDbColumn(items = []) {
  const list = Array.isArray(items) ? items : [];
  const ids = new Set(list.map((item) => hubItemDatabaseMeta(item).databaseId).filter(Boolean));
  return ids.size > 1 || list.some((item) => {
    const meta = hubItemDatabaseMeta(item);
    return Boolean(meta.databaseId) && !meta.isCurrentDb;
  });
}

function mapHubRow(item, includeDb) {
  const row = [
    displayText(readFirst(item, ['INV_NO', 'inv_no'], '')),
    displayText(readFirst(item, ['MODEL_NAME', 'model_name'], '')),
    displayText(readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], '')),
    displayText(readFirst(item, ['PART_NO', 'part_no'], '')),
  ];
  if (includeDb) row.push(hubItemDatabaseMeta(item).dbName);
  return row;
}

function warehouseQtyValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  return Number.isFinite(num) ? num : displayText(value);
}

function mapWarehouseRow(row) {
  return [
    displayText(row?.nomenclature_code),
    displayText(row?.nomenclature_name, '-'),
    warehouseQtyValue(row?.qty_balance),
  ];
}

function padRow(row, width) {
  const next = Array.isArray(row) ? [...row] : [];
  while (next.length < width) next.push('');
  return next.slice(0, width);
}

function joinSideBySide(left, right, leftWidth, gap = GAP_COLUMNS) {
  return [...padRow(left, leftWidth), ...Array(gap).fill(''), ...(Array.isArray(right) ? right : [])];
}

function formatFileToken(value, fallback = 'сотрудник') {
  const normalized = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.slice(0, 80) || fallback;
}

export function sanitizeSheetName(value) {
  const cleaned = String(value || 'Сотрудник')
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || 'Сотрудник';
}

export function formatEmployeeEquipmentFilename(employeeName, exportedAt = new Date()) {
  const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  const stamp = Number.isNaN(date.getTime())
    ? 'export'
    : [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
    ].join('-');
  return `оборудование-${formatFileToken(employeeName)}-${stamp}.xlsx`;
}

function formatDisplayDate(exportedAt) {
  const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function warehouseEmptyLabel(status) {
  if (status === 'not_found') return 'Склад не найден';
  if (status === 'ambiguous') return 'Выберите склад';
  return 'Нет позиций';
}

function warehouseSectionTitle({ status, warehouseName, count }) {
  if (status === 'not_found') return 'Склад 1С: не найден';
  if (status === 'ambiguous') return 'Склад 1С: уточните склад';
  const namePart = warehouseName ? ` — ${warehouseName}` : '';
  return `Склад 1С${namePart} (${count})`;
}

function autosizeColumns(aoa, minWidths = []) {
  const widths = minWidths.map((value) => Number(value) || 8);
  aoa.forEach((row) => {
    (Array.isArray(row) ? row : []).forEach((cell, index) => {
      const len = String(cell ?? '').length + 2;
      widths[index] = Math.min(MAX_COL_WIDTH, Math.max(widths[index] || 8, len));
    });
  });
  return widths.map((wch) => ({ wch }));
}

export function buildEmployeeEquipmentSheet({
  employeeName = '',
  hubItems = [],
  warehouseBalances = [],
  warehouseName = '',
  warehouseStatus = '',
  includeWarehouse = false,
  filterText = '',
  exportedAt = new Date(),
} = {}) {
  const includeDb = shouldShowHubDbColumn(hubItems);
  const hubHeaders = includeDb
    ? ['Инв. №', 'Модель', 'Серийник', 'Парт. №', 'База']
    : ['Инв. №', 'Модель', 'Серийник', 'Парт. №'];
  const warehouseHeaders = ['Код', 'Номенклатура', 'Кол-во'];
  const leftWidth = hubHeaders.length;
  const hubRows = (Array.isArray(hubItems) ? hubItems : []).map((item) => mapHubRow(item, includeDb));
  const warehouseRows = includeWarehouse
    ? (Array.isArray(warehouseBalances) ? warehouseBalances : []).map(mapWarehouseRow)
    : [];

  const aoa = [
    ['Сотрудник', displayText(employeeName)],
    ['Дата выгрузки', formatDisplayDate(exportedAt)],
  ];
  const filter = String(filterText || '').trim();
  if (filter) aoa.push(['Фильтр', filter]);
  aoa.push([]);

  const hubTitle = `В Хабе (${hubRows.length})`;
  const warehouseTitle = warehouseSectionTitle({
    status: warehouseStatus,
    warehouseName,
    count: warehouseRows.length,
  });
  const sectionRowIndex = aoa.length;
  if (includeWarehouse) {
    aoa.push(joinSideBySide([hubTitle], [warehouseTitle], leftWidth));
    aoa.push(joinSideBySide(hubHeaders, warehouseHeaders, leftWidth));
  } else {
    aoa.push([hubTitle]);
    aoa.push([...hubHeaders]);
  }

  const headerRowIndex = aoa.length - 1;
  const dataRowCount = Math.max(hubRows.length, includeWarehouse ? warehouseRows.length : 0, 1);
  for (let index = 0; index < dataRowCount; index += 1) {
    const left = hubRows[index]
      || (index === 0 && hubRows.length === 0 ? ['Нет оборудования'] : []);
    if (!includeWarehouse) {
      aoa.push(padRow(left, leftWidth));
      continue;
    }
    const right = warehouseRows[index]
      || (index === 0 && warehouseRows.length === 0 ? [warehouseEmptyLabel(warehouseStatus)] : []);
    aoa.push(joinSideBySide(left, right, leftWidth));
  }

  const totalCols = includeWarehouse ? leftWidth + GAP_COLUMNS + warehouseHeaders.length : leftWidth;
  const minWidths = includeWarehouse
    ? [...(includeDb ? [14, 28, 18, 16, 16] : [14, 28, 18, 16]), 3, 12, 36, 10]
    : (includeDb ? [14, 28, 18, 16, 16] : [14, 28, 18, 16]);
  const merges = includeWarehouse
    ? [
      { s: { r: sectionRowIndex, c: 0 }, e: { r: sectionRowIndex, c: leftWidth - 1 } },
      {
        s: { r: sectionRowIndex, c: leftWidth + GAP_COLUMNS },
        e: { r: sectionRowIndex, c: totalCols - 1 },
      },
    ]
    : [{ s: { r: sectionRowIndex, c: 0 }, e: { r: sectionRowIndex, c: Math.max(leftWidth - 1, 0) } }];

  return {
    aoa,
    cols: autosizeColumns(aoa, minWidths),
    merges,
    freezeRows: headerRowIndex + 1,
    sheetName: sanitizeSheetName(employeeName || 'Сотрудник'),
    filename: formatEmployeeEquipmentFilename(employeeName, exportedAt),
  };
}

export async function exportEmployeeEquipmentWorkbook(params = {}) {
  const XLSX = await import('xlsx');
  const model = buildEmployeeEquipmentSheet(params);
  const worksheet = XLSX.utils.aoa_to_sheet(model.aoa);
  worksheet['!cols'] = model.cols;
  worksheet['!merges'] = model.merges;
  worksheet['!views'] = [{
    state: 'frozen',
    ySplit: model.freezeRows,
    topLeftCell: `A${model.freezeRows + 1}`,
  }];
  worksheet['!pageSetup'] = {
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, model.sheetName);
  XLSX.writeFile(workbook, model.filename);
  return model.filename;
}
