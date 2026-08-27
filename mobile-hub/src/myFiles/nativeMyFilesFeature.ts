import type { Href } from 'expo-router';

export function resolveNativeMyFilesEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

export const NATIVE_MY_FILES_ENABLED = resolveNativeMyFilesEnabled(process.env.EXPO_PUBLIC_NATIVE_MY_FILES_ENABLED);

export type NativeMyFilesDestination = { pathname: '/(shell)/my-files' };

export function nativeMyFilesDestinationFromPortalPath(path: string): NativeMyFilesDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/my-files', '/my-files/'].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
  return { pathname: '/(shell)/my-files' };
}

export function asMyFilesHref(destination: NativeMyFilesDestination): Href {
  return destination as Href;
}
