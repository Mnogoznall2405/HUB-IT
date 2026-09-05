import type { Href } from 'expo-router';

export function resolveNativeDocflowEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

export const NATIVE_DOCFLOW_ENABLED = resolveNativeDocflowEnabled(
  process.env.EXPO_PUBLIC_NATIVE_DOCFLOW_ENABLED,
);

export type NativeDocflowDestination =
  | { pathname: '/(shell)/docflow' }
  | {
      pathname: '/(shell)/docflow/[taskRef]';
      params: { taskRef: string };
    };

export function nativeDocflowDestinationFromPortalPath(path: string): NativeDocflowDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  const taskRef = String(parsed.searchParams.get('task') || '').trim();
  if (taskRef && ['/docflow', '/docflow/'].includes(parsed.pathname) && !parsed.hash) {
    let decodedTaskRef: string;
    try {
      decodedTaskRef = decodeURIComponent(taskRef);
    } catch {
      return null;
    }
    return {
      pathname: '/(shell)/docflow/[taskRef]',
      params: { taskRef: decodedTaskRef },
    };
  }
  if (!['/docflow', '/docflow/'].includes(parsed.pathname) || parsed.hash || parsed.search) return null;
  return { pathname: '/(shell)/docflow' };
}

export function docflowPortalPath(): string {
  return '/docflow';
}

export function asDocflowHref(destination: NativeDocflowDestination): Href {
  return destination as Href;
}
