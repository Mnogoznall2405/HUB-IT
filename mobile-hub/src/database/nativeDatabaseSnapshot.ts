import type {
  CurrentDatabase,
  EquipmentAct,
  EquipmentRecord,
  ConsumableRecord,
  EquipmentWorkHistory,
  EquipmentWorkKind,
} from '../api/databaseApi';
import type { DatabaseOption } from '../account/accountFormat';
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
