import { readFirst } from './databaseRecordModel';
import { isNotIn1cPartNo, isUsableHubPartNo } from './warehouse1cShared';

/** Same normalization as backend `_normalize_hub_part_no_text`. */
export function normalizeCompareKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Synonyms for equipment type names — a 1C nomenclature row matches the
 * type filter when its name contains any of these needles, not only the
 * literal type name («Системный блок» should also find «Компьютер …»).
 */
const TYPE_NAME_ALIASES = {
  'системный блок': ['компьютер', 'системник', 'пк'],
  'компьютер': ['системный блок', 'системник', 'пк'],
  'монитор': ['дисплей', 'экран'],
  'ноутбук': ['нетбук', 'laptop'],
  'принтер': ['мфу', 'печатающее устройство'],
  'мфу': ['принтер', 'печатающее устройство'],
  'планшет': ['tablet'],
  'телефон': ['смартфон', 'мобильный'],
  'смартфон': ['телефон'],
  'коммутатор': ['свитч', 'switch'],
  'свитч': ['коммутатор', 'switch'],
  'маршрутизатор': ['роутер'],
  'роутер': ['маршрутизатор'],
  'источник бесперебойного питания': ['ибп', 'ups'],
  'ибп': ['источник бесперебойного питания', 'ups'],
  'телевизор': ['тв', 'панель'],
  'тв': ['телевизор'],
  'веб-камера': ['вебкамера', 'камера'],
  'камера': ['веб-камера', 'вебкамера'],
  'гарнитура': ['наушники'],
  'наушники': ['гарнитура'],
  'сканер штрих': ['сканер'],
};

/** Normalized needles a 1C nomenclature name may contain for this type. */
export function typeNameNeedles(typeName) {
  const base = normalizeCompareKey(typeName);
  if (!base) return [];
  const needles = new Set([base]);
  for (const [key, aliases] of Object.entries(TYPE_NAME_ALIASES)) {
    if (base === key || base.includes(key) || (base.length >= 2 && key.includes(base))) {
      for (const alias of aliases) {
        const normalized = normalizeCompareKey(alias);
        if (normalized) needles.add(normalized);
      }
    }
  }
  return [...needles];
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

export const ROW_MATCH_STATUS = Object.freeze({
  MATCH: 'match',
  DIFF: 'diff',
  ONLY_HUB: 'only_hub',
  ONLY_1C: 'only_1c',
});

export const COMPARE_STATUS_LABEL = Object.freeze({
  [ROW_MATCH_STATUS.MATCH]: 'Совпадает',
  [ROW_MATCH_STATUS.DIFF]: 'Кол-во ≠',
  [ROW_MATCH_STATUS.ONLY_HUB]: 'Только в Хабе',
  [ROW_MATCH_STATUS.ONLY_1C]: 'Только в 1С',
});

const QTY_EPSILON = 1e-6;

/**
 * Per-key quantities on both sides of the join:
 * `qty1cByCode` — total 1C qty per normalized nomenclature code;
 * `countByPartNo` — Hub item count per normalized usable PART_NO.
 */
export function buildCompareMaps({ hubItems = [], balances = [] } = {}) {
  const { byCode } = aggregateEmployeeBalances(balances);
  const { byPartNo } = groupHubItemsByPartNo(hubItems);
  const qty1cByCode = new Map();
  for (const [key, bucket] of byCode.entries()) {
    qty1cByCode.set(key, bucket.qty1c);
  }
  const countByPartNo = new Map();
  for (const [key, group] of byPartNo.entries()) {
    countByPartNo.set(key, group.items.length);
  }
  return { qty1cByCode, countByPartNo };
}

function resolveCompareStatus(key, qty1cByCode, countByPartNo) {
  const in1c = qty1cByCode?.has(key);
  const inHub = countByPartNo?.has(key);
  if (in1c && inHub) {
    const qty1c = qty1cByCode.get(key);
    const hubCount = countByPartNo.get(key);
    return Math.abs(qty1c - hubCount) <= QTY_EPSILON
      ? ROW_MATCH_STATUS.MATCH
      : ROW_MATCH_STATUS.DIFF;
  }
  if (in1c) return ROW_MATCH_STATUS.ONLY_1C;
  if (inHub) return ROW_MATCH_STATUS.ONLY_HUB;
  return null;
}

/** Row status for a Hub item by its PART_NO: match / diff / only_hub / null. */
export function resolveHubRowStatus(partNo, maps) {
  if (!maps || !isUsableHubPartNo(partNo)) return null;
  const key = normalizeCompareKey(partNo);
  if (!key) return null;
  return resolveCompareStatus(key, maps.qty1cByCode, maps.countByPartNo);
}

/** Row status for a 1C balance row by its nomenclature code: match / diff / only_1c / null. */
export function resolve1cRowStatus(nomenclatureCode, maps) {
  if (!maps) return null;
  const key = normalizeCompareKey(nomenclatureCode);
  if (!key) return null;
  return resolveCompareStatus(key, maps.qty1cByCode, maps.countByPartNo);
}

/** Both-side quantities for a raw PART_NO / nomenclature code: {hubCount, qty1c} or null. */
export function compareQtyBreakdown(rawKey, maps) {
  if (!maps) return null;
  const key = normalizeCompareKey(rawKey);
  if (!key) return null;
  const hubCount = maps.countByPartNo?.get(key);
  const qty1c = maps.qty1cByCode?.get(key);
  if (hubCount === undefined && qty1c === undefined) return null;
  return { hubCount: hubCount ?? 0, qty1c: qty1c ?? 0 };
}

/**
 * Per the 1C contract an incomplete/unknown balance snapshot must not be
 * treated as a smaller warehouse — matching output gets a warning then.
 */
export function isBalancesMetaIncomplete(meta = null) {
  if (!meta || typeof meta !== 'object') return true;
  const status = String(meta.status || '').trim().toLowerCase();
  if (status !== 'ok') return true;
  return Boolean(meta.truncated || meta.has_more || meta.hasMore);
}

/** Summary payload is trustworthy only when the 1C snapshot is complete. */
export function isEmployeeCompareSummaryComplete(meta = null) {
  if (!meta || typeof meta !== 'object') return false;
  const balancesStatus = meta.balances_status ?? meta.balancesStatus;
  return String(meta.status || '').trim().toLowerCase() === 'ok'
    && !meta.truncated
    && !meta.has_more
    && !meta.hasMore
    && !meta.balances_truncated
    && !meta.balancesTruncated
    && !meta.catalog_truncated
    && !meta.catalogTruncated
    && (balancesStatus === undefined
      || String(balancesStatus || '').trim().toLowerCase() === 'ok');
}

// Значки сверки справочные: снимок годен 30 минут (как окно stale-while-revalidate на бэкенде),
// а обновляется в фоне раз в 10 минут — медленный мост 1С не должен гасить значки.
export const EMPLOYEE_COMPARE_MAX_AGE_MS = 30 * 60_000;
export const EMPLOYEE_COMPARE_REFRESH_INTERVAL_MS = 10 * 60_000;

export function formatEmployeeCompareSnapshotTime(asOf) {
  const stamp = typeof asOf === 'number' ? asOf : Date.parse(asOf);
  if (!Number.isFinite(stamp)) return '';
  return new Date(stamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function isEmployeeCompareSnapshotFresh(asOf, now = Date.now()) {
  if (asOf === null || asOf === undefined || asOf === '') return false;
  if (!Number.isFinite(now)) return false;
  const stamp = typeof asOf === 'number' ? asOf : Date.parse(asOf);
  if (!Number.isFinite(stamp)) return false;
  const age = now - stamp;
  return age >= 0 && age < EMPLOYEE_COMPARE_MAX_AGE_MS;
}

export function toFiniteQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

export function areBalanceQuantitiesValid(balances = []) {
  if (!Array.isArray(balances)) return false;
  return balances.every((row) => {
    const qty = toFiniteQuantity(row?.qty_balance);
    return qty !== null && qty >= 0;
  });
}

export function buildEmployeeCompareSummary({
  ownerNo,
  employeeName = '',
  warehouse = null,
  hubItems = [],
  balances = [],
  asOf,
} = {}) {
  const items = Array.isArray(hubItems) ? hubItems : [];
  const rows = Array.isArray(balances) ? balances : [];
  const { noPartNoItems, notIn1cItems } = groupHubItemsByPartNo(items);
  const maps = buildCompareMaps({ hubItems: items, balances: rows });
  const { qty1cByCode, countByPartNo } = maps;

  const counts = {
    match: 0,
    diff: 0,
    only_hub: 0,
    only_1c: 0,
    no_part: noPartNoItems.length,
    not_in_1c: notIn1cItems.length,
    hub_items: items.length,
  };
  const partStatus = {};
  const partQuantities = {};
  for (const key of new Set([...countByPartNo.keys(), ...qty1cByCode.keys()])) {
    const status = countByPartNo.has(key)
      ? resolveHubRowStatus(key, maps)
      : resolve1cRowStatus(key, maps);
    if (status && counts[status] !== undefined) counts[status] += 1;
    if (countByPartNo.has(key)) {
      partStatus[key] = status;
      partQuantities[key] = {
        hub_count: countByPartNo.get(key),
        qty_1c: qty1cByCode.has(key) ? qty1cByCode.get(key) : null,
      };
    }
  }

  let status;
  if (counts.diff) status = 'diff';
  else if (counts.only_hub) status = 'only_hub';
  else if (counts.only_1c) status = 'only_1c';
  else if (countByPartNo.size === 0 && qty1cByCode.size === 0 && counts.no_part > 0) {
    status = 'unknown';
  } else status = 'match';

  return {
    owner_no: ownerNo,
    employee_name: employeeName,
    warehouse_ref: warehouse?.ref || '',
    warehouse_name: warehouse?.name || '',
    status,
    part_status: partStatus,
    part_quantities: partQuantities,
    counts,
    as_of: asOf,
  };
}

const QTY_COMPARE_EPSILON = 1e-6;
const RELIABLE_SUMMARY_STATUS = new Set(['match', 'diff', 'only_hub', 'only_1c']);

/**
 * The owner has no 1C warehouse to compare against: 'no_warehouse' (nothing matched) or
 * 'ambiguous' (too many similar candidates). Only for rows with a usable PART_NO and a fresh
 * summary — otherwise the reviewer would see noise instead of a real gap.
 */
export function resolveNoWarehouse(summary, partNo) {
  if (!isEmployeeCompareSnapshotFresh(summary?.as_of) || !isUsableHubPartNo(partNo)) return null;
  const status = String(summary?.status || '');
  return status === 'no_warehouse' || status === 'ambiguous' ? status : null;
}

/**
 * Automatic per-row comparison with 1C: the row's PART_NO against the owner's 1C balance.
 * Returns { matched, hubCount, qty1c } or null when the summary is stale/unreliable or the
 * PART_NO has no usable counterpart — i.e. nothing to show.
 */
export function resolvePartCompare(summary, partNo) {
  const summaryReliable = isEmployeeCompareSnapshotFresh(summary?.as_of)
    && RELIABLE_SUMMARY_STATUS.has(String(summary?.status || ''));
  if (!summaryReliable || !isUsableHubPartNo(partNo)) return null;
  const quantities = summary?.part_quantities?.[normalizeCompareKey(partNo)];
  const hubCount = toFiniteQuantity(quantities?.hub_count);
  const qty1c = quantities?.qty_1c === null || quantities?.qty_1c === undefined
    ? null
    : toFiniteQuantity(quantities.qty_1c);
  if (hubCount === null || !Number.isInteger(hubCount) || hubCount <= 0) return null;
  if (qty1c === null || qty1c < 0) return null;
  return { matched: Math.abs(qty1c - hubCount) <= QTY_COMPARE_EPSILON, hubCount, qty1c };
}
