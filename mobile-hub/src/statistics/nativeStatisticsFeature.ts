import type { Href } from 'expo-router';

export function resolveNativeStatisticsEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

export const NATIVE_STATISTICS_ENABLED = resolveNativeStatisticsEnabled(
  process.env.EXPO_PUBLIC_NATIVE_STATISTICS_ENABLED,
);

export type NativeStatisticsDestination = { pathname: '/(shell)/statistics' };

export function nativeStatisticsDestinationFromPortalPath(path: string): NativeStatisticsDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/statistics', '/statistics/'].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
  return { pathname: '/(shell)/statistics' };
}

export function asStatisticsHref(destination: NativeStatisticsDestination): Href {
  return destination as Href;
}
