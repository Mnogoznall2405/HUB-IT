import type { Href } from 'expo-router';
import type { DatabaseViewMode, EquipmentDetailTab } from './nativeDatabaseModel';

export function resolveNativeDatabaseEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

export const NATIVE_DATABASE_ENABLED = resolveNativeDatabaseEnabled(process.env.EXPO_PUBLIC_NATIVE_DATABASE_ENABLED);

export type NativeDatabaseDestination =
  | {
      pathname: '/(shell)/database';
      params?: { q?: string; mode?: DatabaseViewMode; consumable?: string; databaseId?: string; scan?: string };
    }
  | {
      pathname: '/(shell)/database/[invNo]';
      params: { invNo: string; databaseId?: string; tab?: EquipmentDetailTab };
    };

function firstParam(params: URLSearchParams, keys: string[]): string {
  for (const key of keys) {
    const value = String(params.get(key) || '').trim();
    if (value) return value;
  }
  return '';
}

export function nativeDatabaseDestinationFromPortalPath(path: string): NativeDatabaseDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (parsed.pathname !== '/database') return null;

  const supported = new Set([
    'q', 'search', 'mode', 'tab', 'scan',
    'inv_no', 'invNo', 'equipment',
    'consumable', 'consumable_id', 'consumableId',
    'db_id',
  ]);
  if ([...parsed.searchParams.keys()].some((key) => !supported.has(key))) return null;

  const invNo = firstParam(parsed.searchParams, ['inv_no', 'invNo', 'equipment']);
  const databaseId = firstParam(parsed.searchParams, ['db_id']);
  if (invNo.length > 200 || databaseId.length > 100) return null;

  // Consumable QR carries ITEMS.ID — legacy consumable INV_NO can repeat.
  const consumableId = firstParam(parsed.searchParams, ['consumable', 'consumable_id', 'consumableId']);
  if (consumableId) {
    if (!/^\d{1,12}$/.test(consumableId)) return null;
    return {
      pathname: '/(shell)/database',
      params: { consumable: consumableId, ...(databaseId ? { databaseId } : {}) },
    };
  }
  const tabValue = firstParam(parsed.searchParams, ['tab']);
  if (tabValue && !['general', 'works', 'acts', 'history'].includes(tabValue)) return null;
  const tab: EquipmentDetailTab | undefined = ['general', 'works', 'acts', 'history'].includes(tabValue)
    ? tabValue as EquipmentDetailTab
    : undefined;
  if (invNo) {
    return {
      pathname: '/(shell)/database/[invNo]',
      params: { invNo, ...(databaseId ? { databaseId } : {}), ...(tab ? { tab } : {}) },
    };
  }
  if (databaseId || tabValue) return null;
  const query = firstParam(parsed.searchParams, ['q', 'search']);
  if (query.length > 500) return null;
  const modeValue = firstParam(parsed.searchParams, ['mode']);
  if (modeValue && !['equipment', 'consumables', 'acts'].includes(modeValue)) return null;
  const mode: DatabaseViewMode = modeValue === 'acts' || modeValue === 'consumables' ? modeValue : 'equipment';
  const scanValue = firstParam(parsed.searchParams, ['scan']);
  if (scanValue && scanValue !== '1') return null;
  return {
    pathname: '/(shell)/database',
    params: { ...(query ? { q: query } : {}), ...(mode !== 'equipment' ? { mode } : {}), ...(scanValue === '1' ? { scan: '1' } : {}) },
  };
}

export function nativeEquipmentDestination(
  invNo: string,
  tab?: EquipmentDetailTab,
  databaseId?: string,
): Extract<NativeDatabaseDestination, { pathname: '/(shell)/database/[invNo]' }> {
  return {
    pathname: '/(shell)/database/[invNo]',
    params: {
      invNo: String(invNo || '').trim(),
      ...(databaseId ? { databaseId: String(databaseId).trim() } : {}),
      ...(tab ? { tab } : {}),
    },
  };
}

export function asDatabaseHref(destination: NativeDatabaseDestination): Href {
  return destination as Href;
}
