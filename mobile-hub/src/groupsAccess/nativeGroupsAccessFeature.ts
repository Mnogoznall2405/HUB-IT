import type { Href } from 'expo-router';

export function resolveNativeGroupsAccessEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export const NATIVE_GROUPS_ACCESS_ENABLED = resolveNativeGroupsAccessEnabled(
  process.env.EXPO_PUBLIC_NATIVE_GROUPS_ACCESS_ENABLED,
);

export type NativeGroupsAccessDestination = { pathname: '/(shell)/groups-access' };

export function nativeGroupsAccessDestinationFromPortalPath(path: string): NativeGroupsAccessDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/groups-access', '/groups-access/'].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
  return { pathname: '/(shell)/groups-access' };
}

export function groupsAccessPortalPath(): string {
  return '/groups-access';
}

export function asGroupsAccessHref(destination: NativeGroupsAccessDestination): Href {
  return destination as Href;
}
