import type { Warehouse1CBalance, Warehouse1CListMeta } from '../api/warehouse1cApi';

const PART_NO_PLACEHOLDER_RE = /не\s*найден/i;
const PART_NO_NOT_IN_1C_RE = /^нет\s+в\s+1[сc]/i;

export function isNotIn1cPartNo(value: unknown): boolean {
  const text = String(value || '').trim();
  return Boolean(text) && PART_NO_NOT_IN_1C_RE.test(text);
}

export function isUsableHubPartNo(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text || text === '-' || text === '—') return false;
  if (isNotIn1cPartNo(text)) return false;
  return !PART_NO_PLACEHOLDER_RE.test(text);
}

export function normalizeCompareKey(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export type Warehouse1cCompareStatus = 'match' | 'diff' | 'only_hub' | 'only_1c';

export const COMPARE_STATUS_LABEL: Record<Warehouse1cCompareStatus, string> = {
  match: 'Совпадает',
  diff: 'Кол-во ≠',
  only_hub: 'Только в Хабе',
  only_1c: 'Только в 1С',
};

export type Warehouse1cCompareMaps = {
  qty1cByCode: Map<string, number>;
  countByPartNo: Map<string, number>;
};

type HubItemLike = { part_no?: string | null; PART_NO?: string | null };

function toQty(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function buildCompareMaps(options: {
  hubItems: HubItemLike[];
  balances: Warehouse1CBalance[];
}): Warehouse1cCompareMaps {
  const qty1cByCode = new Map<string, number>();
  for (const row of options.balances) {
    const key = normalizeCompareKey(row.nomenclatureCode);
    if (!key) continue;
    qty1cByCode.set(key, (qty1cByCode.get(key) || 0) + toQty(row.qtyBalance));
  }

  const countByPartNo = new Map<string, number>();
  for (const item of options.hubItems) {
    const partNo = item?.part_no ?? item?.PART_NO;
    if (!isUsableHubPartNo(partNo)) continue;
    const key = normalizeCompareKey(partNo);
    if (!key) continue;
    countByPartNo.set(key, (countByPartNo.get(key) || 0) + 1);
  }
  return { qty1cByCode, countByPartNo };
}

const QTY_EPSILON = 1e-6;

function resolveCompareStatus(
  key: string,
  maps: Warehouse1cCompareMaps,
): Warehouse1cCompareStatus | null {
  const in1c = maps.qty1cByCode.has(key);
  const inHub = maps.countByPartNo.has(key);
  if (in1c && inHub) {
    return Math.abs((maps.qty1cByCode.get(key) || 0) - (maps.countByPartNo.get(key) || 0)) <= QTY_EPSILON
      ? 'match'
      : 'diff';
  }
  if (in1c) return 'only_1c';
  if (inHub) return 'only_hub';
  return null;
}

export function resolveHubRowStatus(partNo: unknown, maps: Warehouse1cCompareMaps | null): Warehouse1cCompareStatus | null {
  if (!maps || !isUsableHubPartNo(partNo)) return null;
  const key = normalizeCompareKey(partNo);
  return key ? resolveCompareStatus(key, maps) : null;
}

export function resolve1cRowStatus(nomenclatureCode: unknown, maps: Warehouse1cCompareMaps | null): Warehouse1cCompareStatus | null {
  if (!maps) return null;
  const key = normalizeCompareKey(nomenclatureCode);
  return key ? resolveCompareStatus(key, maps) : null;
}

export function compareQtyBreakdown(
  rawKey: unknown,
  maps: Warehouse1cCompareMaps | null,
): { hubCount: number; qty1c: number } | null {
  if (!maps) return null;
  const key = normalizeCompareKey(rawKey);
  if (!key) return null;
  const hubCount = maps.countByPartNo.get(key);
  const qty1c = maps.qty1cByCode.get(key);
  if (hubCount === undefined && qty1c === undefined) return null;
  return { hubCount: hubCount ?? 0, qty1c: qty1c ?? 0 };
}

export function isWarehouse1cBalancesMetaIncomplete(meta: Warehouse1CListMeta | null): boolean {
  if (!meta) return true;
  const status = String(meta.status || '').trim().toLowerCase();
  if (status && status !== 'ok') return true;
  return Boolean(meta.truncated || meta.hasMore);
}

export type Warehouse1cCompareSummary = {
  matched: number;
  diff: number;
  onlyHub: number;
  only1c: number;
};

export function summarizeCompareMaps(maps: Warehouse1cCompareMaps | null): Warehouse1cCompareSummary {
  const summary: Warehouse1cCompareSummary = { matched: 0, diff: 0, onlyHub: 0, only1c: 0 };
  if (!maps) return summary;
  const keys = new Set([...maps.qty1cByCode.keys(), ...maps.countByPartNo.keys()]);
  for (const key of keys) {
    const status = resolveCompareStatus(key, maps);
    if (status === 'match') summary.matched += 1;
    else if (status === 'diff') summary.diff += 1;
    else if (status === 'only_hub') summary.onlyHub += 1;
    else if (status === 'only_1c') summary.only1c += 1;
  }
  return summary;
}
