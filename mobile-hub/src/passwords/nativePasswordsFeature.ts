import type { Href } from 'expo-router';

export function resolveNativePasswordsEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

export const NATIVE_PASSWORDS_ENABLED = resolveNativePasswordsEnabled(
  process.env.EXPO_PUBLIC_NATIVE_PASSWORDS_ENABLED,
);

export type NativePasswordsDestination = { pathname: '/(shell)/passwords' };

export function nativePasswordsDestinationFromPortalPath(path: string): NativePasswordsDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/passwords', '/passwords/'].includes(parsed.pathname) || parsed.hash) return null;
  const entries = [...parsed.searchParams.entries()];
  if (!entries.length) return { pathname: '/(shell)/passwords' };
  if (entries.length === 1 && entries[0][0] === 'section' && entries[0][1] === 'vault') {
    return { pathname: '/(shell)/passwords' };
  }
  return null;
}

export function passwordsPortalPath(): string {
  return '/passwords';
}

export function asPasswordsHref(destination: NativePasswordsDestination): Href {
  return destination as Href;
}
