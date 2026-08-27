import type { Href } from 'expo-router';

export function resolveNativeComputersEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export const NATIVE_COMPUTERS_ENABLED = resolveNativeComputersEnabled(
  process.env.EXPO_PUBLIC_NATIVE_COMPUTERS_ENABLED,
);

export type NativeComputersDestination = {
  pathname: '/(shell)/computers';
  params?: { q?: string };
};

function normalizeQuery(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nativeComputersDestinationFromPortalPath(path: string): NativeComputersDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/computers', '/computers/'].includes(parsed.pathname) || parsed.hash) return null;
  const entries = [...parsed.searchParams.entries()];
  if (entries.some(([key]) => key !== 'q') || parsed.searchParams.getAll('q').length > 1) return null;
  const q = normalizeQuery(parsed.searchParams.get('q'));
  if (q.length > 200) return null;
  return q
    ? { pathname: '/(shell)/computers', params: { q } }
    : { pathname: '/(shell)/computers' };
}

export function computersPortalPath(options: { q?: string } = {}): string {
  const q = normalizeQuery(options.q);
  return q ? `/computers?q=${encodeURIComponent(q)}` : '/computers';
}

export function asComputersHref(destination: NativeComputersDestination): Href {
  return destination as Href;
}
