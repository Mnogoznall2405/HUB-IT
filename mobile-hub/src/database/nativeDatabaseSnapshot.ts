import type {
  CurrentDatabase,
  EquipmentAct,
  EquipmentRecord,
  ConsumableRecord,
  EquipmentWorkHistory,
  EquipmentWorkKind,
} from '../api/databaseApi';
import type { DatabaseOption } from '../account/accountFormat';
import { readNativeEntitySnapshot, writeNativeEntitySnapshot } from '../cache/nativeSnapshotCache';
import type { DatabaseViewMode } from './nativeDatabaseModel';

export type NativeDatabaseBootstrapSnapshot = {
  databases: DatabaseOption[];
  currentDatabase: CurrentDatabase;
};

export type NativeDatabaseListSnapshot = {
  signature: string;
  databaseId: string;
  mode: DatabaseViewMode;
  query: string;
  equipment: EquipmentRecord[];
  consumables: ConsumableRecord[];
  acts: EquipmentAct[];
  total: number;
  page: number;
  pages: number;
  truncated?: boolean;
};

export type NativeEquipmentDetailSnapshot = {
  databaseId: string;
  equipment: EquipmentRecord;
  acts: EquipmentAct[];
  history: Record<string, unknown>[];
  workHistory: EquipmentWorkHistory[];
  unavailableWorkKinds: EquipmentWorkKind[];
  loadedTabs: Array<'works' | 'acts' | 'history'>;
  invalidatedTabs?: Array<'acts' | 'history'>;
};

function normalizeSearch(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function searchableRecord(record: Record<string, unknown>): string {
  return Object.values(record)
    .filter((value) => ['string', 'number'].includes(typeof value))
    .join(' ')
    .toLocaleLowerCase('ru-RU');
}

export function nativeDatabaseListSignature(
  databaseId: string,
  mode: DatabaseViewMode,
  query: string,
): string {
  return JSON.stringify({
    databaseId: String(databaseId || '').trim(),
    mode,
    query: String(query || '').trim(),
  });
}

export function nativeEquipmentSnapshotKey(databaseId: string, invNo: string): string {
  return `${String(databaseId || '').trim()}:${String(invNo || '').trim()}`;
}

export function filterNativeEquipment(items: EquipmentRecord[], query: string): EquipmentRecord[] {
  const needle = normalizeSearch(query);
  if (!needle) return items;
  return items.filter((item) => searchableRecord(item as unknown as Record<string, unknown>).includes(needle));
}

export function filterNativeActs(items: EquipmentAct[], query: string): EquipmentAct[] {
  const needle = normalizeSearch(query);
  if (!needle) return items;
  return items.filter((item) => {
    const itemText = (item.items || [])
      .map((entry) => searchableRecord(entry as unknown as Record<string, unknown>))
      .join(' ');
    return `${searchableRecord(item as unknown as Record<string, unknown>)} ${itemText}`.includes(needle);
  });
}

export function mergeNativeEquipmentRecord(local: EquipmentRecord, fresh: EquipmentRecord): EquipmentRecord {
  return {
    ...fresh,
    date_create: fresh.date_create ?? local.date_create,
    date_last_modify: fresh.date_last_modify ?? local.date_last_modify,
    changed_by: fresh.changed_by || local.changed_by,
    hub_db_id: fresh.hub_db_id || local.hub_db_id,
    hub_db_name: fresh.hub_db_name || local.hub_db_name,
    raw: { ...local.raw, ...fresh.raw },
  };
}

export async function updateNativeEquipmentDetailSnapshot(
  userId: number,
  databaseId: string,
  invNo: string,
  options: {
    equipment?: EquipmentRecord;
    invalidatedTabs?: Array<'acts' | 'history'>;
    isCurrent?: () => boolean;
  },
): Promise<void> {
  const owner = Number(userId || 0);
  const normalizedInvNo = String(invNo || '').trim();
  const normalizedDatabaseId = String(databaseId || '').trim();
  if (!owner || !normalizedDatabaseId || !normalizedInvNo) return;
  if (options.equipment
    && String(options.equipment.inv_no || '').trim().toLocaleUpperCase('ru-RU')
      !== normalizedInvNo.toLocaleUpperCase('ru-RU')) return;
  if (options.isCurrent && !options.isCurrent()) return;
  const key = nativeEquipmentSnapshotKey(normalizedDatabaseId, normalizedInvNo);
  const stored = (await readNativeEntitySnapshot<NativeEquipmentDetailSnapshot>(
    'database-item-details',
    owner,
    key,
  ))?.data;
  if (options.isCurrent && !options.isCurrent()) return;
  const existing = stored
    && String(stored.databaseId || '').trim() === normalizedDatabaseId
    && String(stored.equipment?.inv_no || '').trim().toLocaleUpperCase('ru-RU')
      === normalizedInvNo.toLocaleUpperCase('ru-RU')
    ? stored
    : null;
  if (!existing && !options.equipment) return;
  const invalidated = [...new Set([...(existing?.invalidatedTabs || []), ...(options.invalidatedTabs || [])])];
  const equipment = options.equipment
    ? (existing?.equipment ? mergeNativeEquipmentRecord(existing.equipment, options.equipment) : options.equipment)
    : existing?.equipment;
  if (!equipment) return;
  await writeNativeEntitySnapshot<NativeEquipmentDetailSnapshot>(
    'database-item-details',
    owner,
    key,
    {
      databaseId: normalizedDatabaseId,
      equipment,
      acts: existing?.acts || [],
      history: existing?.history || [],
      workHistory: existing?.workHistory || [],
      unavailableWorkKinds: existing?.unavailableWorkKinds || [],
      loadedTabs: existing?.loadedTabs || [],
      ...(invalidated.length ? { invalidatedTabs: invalidated } : {}),
    },
  );
}
