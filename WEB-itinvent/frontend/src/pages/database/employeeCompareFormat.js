import { readFirst } from './databaseRecordModel';
import {
  compareQtyBreakdown,
  resolve1cRowStatus,
  resolveHubRowStatus,
} from './employeeCompareModel';
import { formatWarehouseQty } from './warehouse1cShared';

export const COLUMN_HEADER_MIN_HEIGHT = 72;

export const HUB_SORT_GETTERS = {
  inv: (item) => readFirst(item, ['INV_NO', 'inv_no'], ''),
  model: (item) => readFirst(item, ['MODEL_NAME', 'model_name'], ''),
  type: (item) => readFirst(item, ['TYPE_NAME', 'type_name'], ''),
  serial: (item) => readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], ''),
  part: (item) => readFirst(item, ['PART_NO', 'part_no'], ''),
};

export const WH_SORT_GETTERS = {
  code: (row) => row?.nomenclature_code || '',
  name: (row) => row?.nomenclature_name || '',
  qty: (row) => row?.qty_balance ?? '',
};

export function compareSortValues(a, b) {
  const numA = Number(a);
  const numB = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB;
  }
  return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}

export function sortRowsBy(rows, getters, key, dir) {
  const getter = getters[key];
  if (!getter) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => sign * compareSortValues(getter(a), getter(b)));
}

export function toggleSortState(prev, key) {
  return { key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' };
}

/** Подпись «Хаб: N · 1С: M» на строках с расхождением количества. */

export function filterHubItemsByText(items = [], query = '') {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((item) => {
    const haystack = [
      readFirst(item, ['INV_NO', 'inv_no'], ''),
      readFirst(item, ['MODEL_NAME', 'model_name'], ''),
      readFirst(item, ['SERIAL_NO', 'serial_no'], ''),
      readFirst(item, ['HW_SERIAL_NO', 'hw_serial_no'], ''),
      readFirst(item, ['PART_NO', 'part_no'], ''),
      readFirst(item, ['TYPE_NAME', 'type_name'], ''),
      readFirst(item, ['hub_db_name', 'HUB_DB_NAME', 'hub_db_id', 'HUB_DB_ID'], ''),
    ]
      .map((part) => String(part || '').toLowerCase())
      .join(' ');
    return haystack.includes(needle);
  });
}

export function hubItemDatabaseMeta(item) {
  const databaseId = String(item?.hub_db_id || item?.HUB_DB_ID || '').trim();
  const dbName = String(item?.hub_db_name || item?.HUB_DB_NAME || databaseId || '').trim();
  const isCurrentDb = Boolean(item?.is_current_db ?? item?.IS_CURRENT_DB);
  return { databaseId, dbName, isCurrentDb };
}

export const MOVEMENT_DOC_TYPE_LABEL = {
  transfer: 'Перемещение',
  receipt: 'Приходный ордер',
  expense: 'Расходный ордер',
};

export const MOVEMENT_DIRECTION_LABEL = {
  in: 'Приход',
  out: 'Расход',
  inout: 'Приход/расход',
};

export const MOVEMENT_DIRECTION_COLOR = {
  in: 'success',
  out: 'error',
  inout: 'warning',
};

export function formatMovementDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function movementDocTitle(doc) {
  const typeLabel = MOVEMENT_DOC_TYPE_LABEL[doc?.document_type] || '';
  const number = String(doc?.registrar_number || '').trim();
  if (typeLabel && number) return `${typeLabel} №${number}`;
  if (typeLabel) return typeLabel;
  const name = String(doc?.registrar_name || '').trim();
  return name || 'Документ';
}

export function movementDocHaystack(doc) {
  const parts = [
    doc?.registrar_name,
    doc?.registrar_number,
    doc?.transfer_from_warehouse_name,
    doc?.transfer_to_warehouse_name,
  ];
  for (const item of doc?.items || []) {
    parts.push(item?.nomenclature_code, item?.nomenclature_name);
  }
  return parts.map((p) => String(p || '').toLowerCase()).join(' ');
}

export function filterMovementDocsByText(docs, filterText) {
  const query = String(filterText || '').trim().toLowerCase();
  const list = Array.isArray(docs) ? docs : [];
  if (!query) return list;
  return list.filter((doc) => movementDocHaystack(doc).includes(query));
}

// Текстовая выгрузка расхождений сверки Хаб↔1С для буфера обмена.
export function buildDiscrepanciesText({ employeeName, comparisonComplete, hubItems, warehouseBalances, compareMaps }) {
  const lines = [`Сверка с 1С — ${employeeName || 'сотрудник'}`];
  if (!comparisonComplete) {
    lines.push('Полный снимок остатков 1С недоступен; итоговая сверка не сформирована.');
    return lines.join('\n');
  }
  for (const item of Array.isArray(hubItems) ? hubItems : []) {
    const partNo = readFirst(item, ['PART_NO', 'part_no'], '');
    const status = resolveHubRowStatus(partNo, compareMaps);
    if (status !== 'diff' && status !== 'only_hub') continue;
    const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
    const model = readFirst(item, ['MODEL_NAME', 'model_name'], '');
    const breakdown = compareQtyBreakdown(partNo, compareMaps);
    const tail = status === 'diff' && breakdown
      ? `Хаб: ${breakdown.hubCount} / 1С: ${formatWarehouseQty(breakdown.qty1c)}`
      : 'только в Хабе';
    lines.push(`• ${invNo} · ${model} — ${tail}`);
  }
  for (const row of Array.isArray(warehouseBalances) ? warehouseBalances : []) {
    if (resolve1cRowStatus(row?.nomenclature_code, compareMaps) !== 'only_1c') continue;
    lines.push(`• ${row?.nomenclature_code || '—'} ${row?.nomenclature_name || ''} — только в 1С (${formatWarehouseQty(row?.qty_balance)})`);
  }
  if (lines.length === 1) lines.push('Расхождений нет.');
  return lines.join('\n');
}

export const HISTORY_FIELD_LABELS = [
  ['old_employee_name', 'new_employee_name', 'Сотрудник'],
  ['old_branch_name', 'new_branch_name', 'Филиал'],
  ['old_location_name', 'new_location_name', 'Кабинет'],
  ['old_status_name', 'new_status_name', 'Статус'],
  ['old_type_name', 'new_type_name', 'Тип'],
  ['old_model_name', 'new_model_name', 'Модель'],
  ['old_serial_no', 'new_serial_no', 'Серийник'],
  ['old_inv_no', 'new_inv_no', 'Инв. №'],
];
