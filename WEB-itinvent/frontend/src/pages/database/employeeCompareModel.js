import { readFirst } from './databaseRecordModel';
import { compareRuText, isNotIn1cPartNo, isUsableHubPartNo } from './warehouse1cShared';

export const EMPLOYEE_COMPARE_STATUS = Object.freeze({
  MATCH: 'match',
  DIFF: 'diff',
  ONLY_1C: 'only_1c',
  ONLY_HUB: 'only_hub',
});

const STATUS_PRIORITY = {
  [EMPLOYEE_COMPARE_STATUS.DIFF]: 0,
  [EMPLOYEE_COMPARE_STATUS.ONLY_1C]: 1,
  [EMPLOYEE_COMPARE_STATUS.ONLY_HUB]: 2,
  [EMPLOYEE_COMPARE_STATUS.MATCH]: 3,
};

const QTY_EPSILON = 1e-6;

/** Same normalization as backend `_normalize_hub_part_no_text`. */
export function normalizeCompareKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function toQty(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Aggregate raw 1C register rows (series/batch splits) into one bucket per
 * nomenclature code — the client-side twin of `aggregate_balance_rows`.
 * Rows without a code cannot join PART_NO and are returned separately.
 */
export function aggregateEmployeeBalances(balances = []) {
  const byCode = new Map();
  const unjoinable = new Map();

  for (const raw of Array.isArray(balances) ? balances : []) {
    if (!raw || typeof raw !== 'object') continue;
    const qty = toQty(raw.qty_balance);
    const codeKey = normalizeCompareKey(raw.nomenclature_code);
    const nomenclatureRef = String(raw.nomenclature_ref || '').trim();
    const nomenclatureName = String(raw.nomenclature_name || '').trim();

    if (codeKey) {
      let bucket = byCode.get(codeKey);
      if (!bucket) {
        bucket = {
          key: codeKey,
          code: String(raw.nomenclature_code || '').trim(),
          nomenclatureRef: '',
          nomenclatureName: '',
          qty1c: 0,
          details: [],
        };
        byCode.set(codeKey, bucket);
      }
      bucket.qty1c += qty;
      if (!bucket.nomenclatureRef) bucket.nomenclatureRef = nomenclatureRef;
      if (!bucket.nomenclatureName) bucket.nomenclatureName = nomenclatureName;
      bucket.details.push(raw);
    } else {
      const refKey = normalizeCompareKey(nomenclatureRef)
        || normalizeCompareKey(nomenclatureName)
        || `row-${unjoinable.size}`;
      let bucket = unjoinable.get(refKey);
      if (!bucket) {
        bucket = {
          key: `unjoinable:${refKey}`,
          code: '',
          nomenclatureRef,
          nomenclatureName,
          qty1c: 0,
          details: [],
        };
        unjoinable.set(refKey, bucket);
      }
      bucket.qty1c += qty;
      bucket.details.push(raw);
    }
  }

  return { byCode, unjoinable: [...unjoinable.values()] };
}

/** Split Hub items into joinable (usable PART_NO), sentinel «нет в 1С» and pending. */
export function groupHubItemsByPartNo(hubItems = []) {
  const byPartNo = new Map();
  const noPartNoItems = [];
  const notIn1cItems = [];

  for (const item of Array.isArray(hubItems) ? hubItems : []) {
    const partNo = String(readFirst(item, ['PART_NO', 'part_no'], '') || '').trim();
    if (isUsableHubPartNo(partNo)) {
      const key = normalizeCompareKey(partNo);
      let group = byPartNo.get(key);
      if (!group) {
        group = { key, partNo, items: [] };
        byPartNo.set(key, group);
      }
      group.items.push(item);
    } else if (isNotIn1cPartNo(partNo)) {
      notIn1cItems.push(item);
    } else {
      noPartNoItems.push(item);
    }
  }

  return { byPartNo, noPartNoItems, notIn1cItems };
}

function hubItemDisplayName(item) {
  return String(
    readFirst(item, ['MODEL_NAME', 'model_name'], '')
    || readFirst(item, ['TYPE_NAME', 'type_name'], '')
    || '',
  ).trim();
}

function hubGroupDisplayName(items = []) {
  const names = [];
  const seen = new Set();
  for (const item of items) {
    const name = hubItemDisplayName(item);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (!names.length) return '';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function buildRow({ bucket, hubGroup, status }) {
  const hubItems = hubGroup?.items || [];
  const hubCount = hubItems.length;
  const qty1c = bucket ? bucket.qty1c : 0;
  return {
    key: bucket?.key || hubGroup?.key || '',
    code: bucket?.code || hubGroup?.partNo || '',
    nomenclatureRef: bucket?.nomenclatureRef || '',
    name: bucket?.nomenclatureName || hubGroupDisplayName(hubItems) || '-',
    qty1c,
    hubCount,
    delta: qty1c - hubCount,
    hubItems,
    details1c: bucket?.details || [],
    status,
  };
}

function sortCompareRows(rows) {
  return [...rows].sort((left, right) => {
    const byStatus = (STATUS_PRIORITY[left.status] ?? 9) - (STATUS_PRIORITY[right.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    const byName = compareRuText(left.name, right.name);
    if (byName !== 0) return byName;
    return compareRuText(left.code, right.code);
  });
}

/**
 * Full outer join: what the employee holds in 1C (aggregated balances of the
 * matched warehouse) vs in the Hub (items with usable PART_NO), joined by
 * normalized PART_NO ↔ nomenclature code.
 */
export function buildEmployeeCompare({ hubItems = [], balances = [] } = {}) {
  const { byCode, unjoinable } = aggregateEmployeeBalances(balances);
  const { byPartNo, noPartNoItems, notIn1cItems } = groupHubItemsByPartNo(hubItems);

  const rows = [];
  for (const bucket of byCode.values()) {
    const hubGroup = byPartNo.get(bucket.key);
    const hubCount = hubGroup?.items.length || 0;
    let status = EMPLOYEE_COMPARE_STATUS.ONLY_1C;
    if (hubCount > 0) {
      status = Math.abs(bucket.qty1c - hubCount) <= QTY_EPSILON
        ? EMPLOYEE_COMPARE_STATUS.MATCH
        : EMPLOYEE_COMPARE_STATUS.DIFF;
    }
    rows.push(buildRow({ bucket, hubGroup, status }));
  }

  for (const group of byPartNo.values()) {
    if (byCode.has(group.key)) continue;
    rows.push(buildRow({
      bucket: null,
      hubGroup: group,
      status: EMPLOYEE_COMPARE_STATUS.ONLY_HUB,
    }));
  }

  for (const bucket of unjoinable) {
    rows.push(buildRow({
      bucket,
      hubGroup: null,
      status: EMPLOYEE_COMPARE_STATUS.ONLY_1C,
    }));
  }

  const sorted = sortCompareRows(rows);
  const summary = {
    total: sorted.length,
    match: 0,
    diff: 0,
    only1c: 0,
    onlyHub: 0,
    noPartNo: noPartNoItems.length,
    notIn1c: notIn1cItems.length,
  };
  for (const row of sorted) {
    if (row.status === EMPLOYEE_COMPARE_STATUS.MATCH) summary.match += 1;
    else if (row.status === EMPLOYEE_COMPARE_STATUS.DIFF) summary.diff += 1;
    else if (row.status === EMPLOYEE_COMPARE_STATUS.ONLY_1C) summary.only1c += 1;
    else if (row.status === EMPLOYEE_COMPARE_STATUS.ONLY_HUB) summary.onlyHub += 1;
  }

  return { rows: sorted, noPartNoItems, notIn1cItems, summary };
}

function foldCompareText(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function compareRowHaystack(row) {
  const parts = [row.code, row.name, row.nomenclatureRef];
  for (const item of row.hubItems || []) {
    parts.push(
      readFirst(item, ['INV_NO', 'inv_no'], ''),
      readFirst(item, ['MODEL_NAME', 'model_name'], ''),
      readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], ''),
      readFirst(item, ['PART_NO', 'part_no'], ''),
    );
  }
  for (const detail of row.details1c || []) {
    parts.push(detail.series_name, detail.series_number, detail.characteristic_name);
  }
  return parts.map(foldCompareText).join(' ');
}

export function filterEmployeeCompareRows(rows = [], query = '') {
  const needle = foldCompareText(String(query || '').trim());
  if (!needle) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    compareRowHaystack(row).includes(needle)
  ));
}

export function filterCompareItemsByText(items = [], query = '') {
  const needle = foldCompareText(String(query || '').trim());
  if (!needle) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((item) => {
    const haystack = [
      readFirst(item, ['INV_NO', 'inv_no'], ''),
      readFirst(item, ['MODEL_NAME', 'model_name'], ''),
      readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], ''),
      readFirst(item, ['PART_NO', 'part_no'], ''),
    ].map(foldCompareText).join(' ');
    return haystack.includes(needle);
  });
}

/**
 * Per the 1C contract an incomplete/unknown balance snapshot must not be
 * presented as a smaller warehouse — comparison output gets a warning then.
 */
export function isBalancesMetaIncomplete(meta = null) {
  if (!meta || typeof meta !== 'object') return true;
  const status = String(meta.status || '').trim().toLowerCase();
  if (status && status !== 'ok') return true;
  return Boolean(meta.truncated || meta.has_more || meta.hasMore);
}
