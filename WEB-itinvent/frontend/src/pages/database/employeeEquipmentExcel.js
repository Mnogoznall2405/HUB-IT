import { readFirst } from './databaseRecordModel';
import {
  COMPARE_STATUS_LABEL,
  resolve1cRowStatus,
  resolveHubRowStatus,
} from './employeeCompareModel';

const GAP_COLUMNS = 1;
const MAX_COL_WIDTH = 56;

const STATUS_FILL_RGB = {
  match: '63BE7B',
  diff: 'FFC000',
  only_hub: 'FF7C80',
  only_1c: '5B9BD5',
};

const NO_KEY_FILTER = 'none';

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
  statusFilter = '',
  typeFilter = '',
  compareMaps = null,
  exportedAt = new Date(),
} = {}) {
  const includeDb = shouldShowHubDbColumn(hubItems);
  const hasCompare = Boolean(includeWarehouse && compareMaps);
  const hubHeaders = includeDb
    ? ['Инв. №', 'Модель', 'Серийник', 'Парт. №', 'База']
    : ['Инв. №', 'Модель', 'Серийник', 'Парт. №'];
  const warehouseHeaders = ['Код', 'Номенклатура', 'Кол-во'];
  if (hasCompare) {
    hubHeaders.push('Сверка');
    warehouseHeaders.push('Сверка');
  }
  const leftWidth = hubHeaders.length;
  const hubEntries = (Array.isArray(hubItems) ? hubItems : []).map((item) => {
    const cells = mapHubRow(item, includeDb);
    const status = hasCompare
      ? resolveHubRowStatus(readFirst(item, ['PART_NO', 'part_no'], ''), compareMaps)
      : null;
    if (hasCompare) cells.push(COMPARE_STATUS_LABEL[status] || '');
    return { cells, status };
  });
  const warehouseEntries = includeWarehouse
    ? (Array.isArray(warehouseBalances) ? warehouseBalances : []).map((row) => {
      const cells = mapWarehouseRow(row);
      const status = hasCompare ? resolve1cRowStatus(row?.nomenclature_code, compareMaps) : null;
      if (hasCompare) cells.push(COMPARE_STATUS_LABEL[status] || '');
      return { cells, status };
    })
    : [];

  const aoa = [
    ['Сотрудник', displayText(employeeName)],
    ['Дата выгрузки', formatDisplayDate(exportedAt)],
  ];
  const filter = String(filterText || '').trim();
  if (filter) aoa.push(['Фильтр', filter]);
  const statusFilterLabel = statusFilter === NO_KEY_FILTER
    ? 'Без парт. № / кода'
    : COMPARE_STATUS_LABEL[statusFilter];
  if (statusFilterLabel) aoa.push(['Фильтр по статусу', statusFilterLabel]);
  const type = String(typeFilter || '').trim();
  if (type) aoa.push(['Тип оборудования', type]);
  if (hasCompare) {
    const summary = { match: 0, diff: 0, only_hub: 0, only_1c: 0, none: 0 };
    for (const entry of hubEntries) summary[entry.status || 'none'] += 1;
    for (const entry of warehouseEntries) summary[entry.status || 'none'] += 1;
    aoa.push([
      'Сводка сверки',
      `Совпадает: ${summary.match} | Кол-во ≠: ${summary.diff} | Только в Хабе: ${summary.only_hub} | Только в 1С: ${summary.only_1c} | Без парт. №: ${summary.none}`,
    ]);
  }
  aoa.push([]);

  const hubTitle = `В Хабе (${hubEntries.length})`;
  const warehouseTitle = warehouseSectionTitle({
    status: warehouseStatus,
    warehouseName,
    count: warehouseEntries.length,
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
  const fills = [];
  const dataRowCount = Math.max(hubEntries.length, includeWarehouse ? warehouseEntries.length : 0, 1);
  for (let index = 0; index < dataRowCount; index += 1) {
    const leftEntry = hubEntries[index]
      || (index === 0 && hubEntries.length === 0 ? { cells: ['Нет оборудования'], status: null } : null);
    if (!includeWarehouse) {
      aoa.push(padRow(leftEntry?.cells || [], leftWidth));
      continue;
    }
    const rightEntry = warehouseEntries[index]
      || (index === 0 && warehouseEntries.length === 0
        ? { cells: [warehouseEmptyLabel(warehouseStatus)], status: null }
        : null);
    aoa.push(joinSideBySide(leftEntry?.cells || [], rightEntry?.cells || [], leftWidth));
    fills.push({
      row: aoa.length - 1,
      leftStatus: leftEntry?.status || null,
      rightStatus: rightEntry?.status || null,
    });
  }

  const totalCols = includeWarehouse ? leftWidth + GAP_COLUMNS + warehouseHeaders.length : leftWidth;
  const minWidths = includeWarehouse
    ? [
      ...(includeDb ? [14, 28, 18, 16, 16] : [14, 28, 18, 16]),
      ...(hasCompare ? [12] : []),
      3, 12, 36, 10,
      ...(hasCompare ? [12] : []),
    ]
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
    fills,
    leftCols: [0, leftWidth - 1],
    rightCols: includeWarehouse ? [leftWidth + GAP_COLUMNS, totalCols - 1] : null,
    freezeRows: headerRowIndex + 1,
    sheetName: sanitizeSheetName(employeeName || 'Сотрудник'),
    filename: formatEmployeeEquipmentFilename(employeeName, exportedAt),
  };
}

const MOVEMENT_DIRECTION_EXCEL_LABEL = {
  in: 'Приход',
  out: 'Расход',
  inout: 'Приход/расход',
};

/** Rows for the "Перемещения" sheet: one row per document position, docs grouped. */
export function buildMovementsSheetRows(movements = []) {
  const aoa = [
    ['Движения склада 1С'],
    [],
    ['Дата', 'Документ', 'Направление', 'Откуда', 'Куда', 'Номенклатура', 'Код', 'Кол-во'],
  ];
  for (const doc of Array.isArray(movements) ? movements : []) {
    const items = Array.isArray(doc?.items) ? doc.items : [];
    const docTitle = [doc?.registrar_number, doc?.registrar_name]
      .map((v) => String(v || '').trim())
      .filter(Boolean)[0] || '';
    const base = [
      doc?.period || doc?.registrar_date || '',
      docTitle,
      MOVEMENT_DIRECTION_EXCEL_LABEL[doc?.direction] || '',
      doc?.transfer_from_warehouse_name || '',
      doc?.transfer_to_warehouse_name || doc?.warehouse_name || '',
    ];
    if (!items.length) {
      aoa.push([...base, '', '', '']);
      continue;
    }
    items.forEach((item, index) => {
      const docCols = index === 0 ? base : ['', '', '', '', ''];
      aoa.push([
        ...docCols,
        item?.nomenclature_name || '',
        item?.nomenclature_code || '',
        item?.qty_in ?? item?.qty_out ?? '',
      ]);
    });
  }
  return aoa;
}

export async function exportEmployeeEquipmentWorkbook(params = {}) {
  const XLSX = await import('xlsx-js-style');
  const model = buildEmployeeEquipmentSheet(params);
  const worksheet = XLSX.utils.aoa_to_sheet(model.aoa);
  worksheet['!cols'] = model.cols;
  worksheet['!merges'] = model.merges;

  const paintCell = (rowIdx, colIdx, status) => {
    const rgb = STATUS_FILL_RGB[status];
    if (!rgb) return;
    const address = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
    const cell = worksheet[address] || (worksheet[address] = { t: 's', v: '' });
    cell.s = { fill: { patternType: 'solid', fgColor: { rgb } } };
  };
  (Array.isArray(model.fills) ? model.fills : []).forEach(({ row, leftStatus, rightStatus }) => {
    const [leftStart, leftEnd] = model.leftCols || [0, -1];
    for (let c = leftStart; c <= leftEnd; c += 1) paintCell(row, c, leftStatus);
    if (model.rightCols) {
      const [rightStart, rightEnd] = model.rightCols;
      for (let c = rightStart; c <= rightEnd; c += 1) paintCell(row, c, rightStatus);
    }
  });

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
  if (Array.isArray(params.movements) && params.movements.length) {
    const movementsSheet = XLSX.utils.aoa_to_sheet(buildMovementsSheetRows(params.movements));
    movementsSheet['!cols'] = [
      { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 28 }, { wch: 28 },
      { wch: 45 }, { wch: 16 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(workbook, movementsSheet, 'Перемещения');
  }
  XLSX.writeFile(workbook, model.filename);
  return model.filename;
}
