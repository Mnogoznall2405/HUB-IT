import type { Href } from 'expo-router';

export function resolveNativeWarehouse1CEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export const NATIVE_WAREHOUSE_1C_ENABLED = resolveNativeWarehouse1CEnabled(
  process.env.EXPO_PUBLIC_NATIVE_WAREHOUSE_1C_ENABLED,
);

const WAREHOUSE_1C_TABS = new Set(['balances', 'movements', 'dismissed', 'catalog']);

export type NativeWarehouse1CDestination = {
  pathname: '/(shell)/warehouse-1c';
  params?: {
    tab?: 'balances' | 'movements' | 'dismissed' | 'catalog';
    nomenclatureRef?: string;
    warehouseRef?: string;
  };
};

function boundedRef(value: string | null): string {
  return String(value || '').trim().slice(0, 64);
}

export function nativeWarehouse1CDestinationFromPortalPath(path: string): NativeWarehouse1CDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/warehouse-1c', '/warehouse-1c/'].includes(parsed.pathname) || parsed.hash) return null;
  const params: NonNullable<NativeWarehouse1CDestination['params']> = {};
  const tab = parsed.searchParams.get('tab');
  if (tab && WAREHOUSE_1C_TABS.has(tab)) params.tab = tab as NonNullable<NativeWarehouse1CDestination['params']>['tab'];
  const nomenclatureRef = boundedRef(parsed.searchParams.get('nomenclatureRef'));
  if (nomenclatureRef) params.nomenclatureRef = nomenclatureRef;
  const warehouseRef = boundedRef(parsed.searchParams.get('warehouseRef'));
  if (warehouseRef) params.warehouseRef = warehouseRef;
  return {
    pathname: '/(shell)/warehouse-1c',
    ...(Object.keys(params).length ? { params } : {}),
  };
}

export function warehouse1CPortalPath(options: { kind?: 'nomenclature' | 'warehouses'; ref?: string } = {}): string {
  const ref = String(options.ref || '').trim().slice(0, 64);
  if (!ref) return '/warehouse-1c';
  const query = new URLSearchParams();
  query.set(options.kind === 'warehouses' ? 'warehouseRef' : 'nomenclatureRef', ref);
  return `/warehouse-1c?${query.toString()}`;
}

export function asWarehouse1CHref(destination: NativeWarehouse1CDestination): Href {
  return destination as Href;
}
