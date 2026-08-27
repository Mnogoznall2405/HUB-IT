import apiClient from './client';

const QUERY_TIMEOUT_MS = 50_000;
const EMPTY_1C_REF = '00000000-0000-0000-0000-000000000000';

type UnknownRecord = Record<string, unknown>;

export type Warehouse1CCatalogKind = 'nomenclature' | 'warehouses';

export type Warehouse1CCatalogItem = {
  ref: string;
  code: string;
  name: string;
};

export type Warehouse1CCatalogStatusValue = 'ok' | 'stale' | 'incomplete' | 'error' | 'unknown';

export type Warehouse1CCatalogStatus = {
  status: Warehouse1CCatalogStatusValue;
  nomenclature_count: number;
  warehouses_count: number;
  updated_at: string;
  age_seconds: number | null;
  stale_after_seconds: number | null;
  nomenclature_truncated: boolean;
  warehouses_truncated: boolean;
  sync_in_progress: boolean;
  complete: boolean;
  source: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function boundedString(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function count(value: unknown, max = 10_000_000): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, Math.floor(parsed))) : 0;
}

function optionalCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(31_536_000_000, Math.max(0, Math.floor(parsed))) : null;
}

function isMeaningfulRef(value: unknown): boolean {
  const ref = boundedString(value, 64).toLowerCase();
  return Boolean(ref) && ref !== EMPTY_1C_REF;
}

function normalizeStatus(value: unknown): Warehouse1CCatalogStatusValue {
  const status = boundedString(value, 32).toLowerCase();
  return ['ok', 'stale', 'incomplete', 'error', 'unknown'].includes(status)
    ? status as Warehouse1CCatalogStatusValue
    : 'unknown';
}

export function normalizeWarehouse1CCatalogItem(value: unknown): Warehouse1CCatalogItem | null {
  const source = asRecord(value);
  if (!isMeaningfulRef(source.ref)) return null;
  const name = boundedString(source.name, 500);
  if (!name) return null;
  return {
    ref: boundedString(source.ref, 64),
    code: boundedString(source.code, 200),
    name,
  };
}

export function normalizeWarehouse1CCatalogItems(payload: unknown, limit: number): Warehouse1CCatalogItem[] {
  const source = asRecord(payload);
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(source.items) ? source.items : (Array.isArray(source.results) ? source.results : []));
  const byRef = new Map<string, Warehouse1CCatalogItem>();
  for (const row of rows) {
    const item = normalizeWarehouse1CCatalogItem(row);
    if (!item) continue;
    const key = item.ref.toLowerCase();
    if (!byRef.has(key)) byRef.set(key, item);
    if (byRef.size >= limit) break;
  }
  return [...byRef.values()];
}

export function normalizeWarehouse1CCatalogStatus(payload: unknown): Warehouse1CCatalogStatus {
  const source = asRecord(payload);
  return {
    status: normalizeStatus(source.status),
    nomenclature_count: count(source.nomenclature_count),
    warehouses_count: count(source.warehouses_count),
    updated_at: boundedString(source.updated_at, 64),
    age_seconds: optionalCount(source.age_seconds),
    stale_after_seconds: optionalCount(source.stale_after_seconds),
    nomenclature_truncated: source.nomenclature_truncated === true,
    warehouses_truncated: source.warehouses_truncated === true,
    sync_in_progress: source.sync_in_progress === true,
    complete: source.complete === true,
    source: boundedString(source.source, 80),
  };
}

export async function getWarehouse1CCatalogStatus(options: { signal?: AbortSignal } = {}): Promise<Warehouse1CCatalogStatus> {
  const response = await apiClient.get('/warehouse-1c/catalog/status', {
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  return normalizeWarehouse1CCatalogStatus(response.data);
}

export async function searchWarehouse1CCatalog(options: {
  kind: Warehouse1CCatalogKind;
  query: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<Warehouse1CCatalogItem[]> {
  const query = boundedString(options.query, 200).replace(/\s+/g, ' ');
  if (query.length < 2) return [];
  const limit = Math.max(1, Math.min(50, Math.floor(Number(options.limit) || 30)));
  const endpoint = options.kind === 'warehouses'
    ? '/warehouse-1c/warehouses/search'
    : '/warehouse-1c/nomenclature/search';
  const response = await apiClient.get(endpoint, {
    params: { q: query, limit },
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  return normalizeWarehouse1CCatalogItems(response.data, limit);
}
