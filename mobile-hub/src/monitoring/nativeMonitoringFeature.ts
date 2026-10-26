import type { Href } from 'expo-router';

export function resolveNativeMonitoringEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

export const NATIVE_MONITORING_ENABLED = resolveNativeMonitoringEnabled(
  process.env.EXPO_PUBLIC_NATIVE_MONITORING_ENABLED,
);

export type NativeMonitoringDestination = { pathname: '/(shell)/monitoring' };

export function nativeMonitoringDestinationFromPortalPath(path: string): NativeMonitoringDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/monitoring', '/monitoring/'].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
  return { pathname: '/(shell)/monitoring' };
}

export function asMonitoringHref(destination: NativeMonitoringDestination): Href {
  return destination as Href;
}
