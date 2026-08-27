import type { Href } from 'expo-router';

export function resolveNativeWarehouse1CEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export const NATIVE_WAREHOUSE_1C_ENABLED = resolveNativeWarehouse1CEnabled(
  process.env.EXPO_PUBLIC_NATIVE_WAREHOUSE_1C_ENABLED,
);

export type NativeWarehouse1CDestination = { pathname: '/(shell)/warehouse-1c' };

export function nativeWarehouse1CDestinationFromPortalPath(path: string): NativeWarehouse1CDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/warehouse-1c', '/warehouse-1c/'].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
  return { pathname: '/(shell)/warehouse-1c' };
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
