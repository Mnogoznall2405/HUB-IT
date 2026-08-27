import type { Href } from 'expo-router';

export function resolveNativeMfuEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export const NATIVE_MFU_ENABLED = resolveNativeMfuEnabled(process.env.EXPO_PUBLIC_NATIVE_MFU_ENABLED);

export type NativeMfuDestination = { pathname: '/(shell)/mfu' };

export function nativeMfuDestinationFromPortalPath(path: string): NativeMfuDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/mfu', '/mfu/'].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
  return { pathname: '/(shell)/mfu' };
}

export function asMfuHref(destination: NativeMfuDestination): Href {
  return destination as Href;
}
