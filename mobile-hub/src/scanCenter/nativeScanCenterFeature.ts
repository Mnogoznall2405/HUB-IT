import type { Href } from 'expo-router';

export function resolveNativeScanCenterEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export const NATIVE_SCAN_CENTER_ENABLED = resolveNativeScanCenterEnabled(
  process.env.EXPO_PUBLIC_NATIVE_SCAN_CENTER_ENABLED,
);

export type NativeScanCenterDestination = { pathname: '/(shell)/scan-center' };

export function nativeScanCenterDestinationFromPortalPath(path: string): NativeScanCenterDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/scan-center', '/scan-center/'].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
  return { pathname: '/(shell)/scan-center' };
}

export function scanCenterPortalPath(): string {
  return '/scan-center';
}

export function asScanCenterHref(destination: NativeScanCenterDestination): Href {
  return destination as Href;
}
