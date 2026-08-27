import type { Href } from 'expo-router';

export function resolveNativeCompanyStructureEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

export const NATIVE_COMPANY_STRUCTURE_ENABLED = resolveNativeCompanyStructureEnabled(
  process.env.EXPO_PUBLIC_NATIVE_COMPANY_STRUCTURE_ENABLED,
);

export type NativeCompanyStructureDestination = {
  pathname: '/(shell)/company-structure';
  params?: { nodeId?: string; blockId?: string };
};

function safeParam(parsed: URL, key: string): string | undefined {
  const values = parsed.searchParams.getAll(key);
  if (values.length > 1) return undefined;
  const value = String(values[0] || '').trim();
  return value && value.length <= 256 ? value : undefined;
}

export function nativeCompanyStructureDestinationFromPortalPath(
  path: string,
): NativeCompanyStructureDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (!['/company-structure', '/company-structure/'].includes(parsed.pathname) || parsed.hash) return null;
  const allowed = new Set(['node', 'block', 'view']);
  if ([...parsed.searchParams.keys()].some((key) => !allowed.has(key))) return null;
  for (const key of allowed) {
    if (parsed.searchParams.getAll(key).length > 1) return null;
  }
  const rawView = String(parsed.searchParams.get('view') || '').trim();
  if (rawView && !['focus', 'overview', 'chart'].includes(rawView)) return null;
  const nodeId = safeParam(parsed, 'node');
  const blockId = safeParam(parsed, 'block');
  const params = { nodeId, blockId };
  return {
    pathname: '/(shell)/company-structure',
    ...(Object.values(params).some(Boolean) ? { params } : {}),
  };
}

export function companyStructurePortalPath(params: { nodeId?: string; blockId?: string } = {}): string {
  const query = new URLSearchParams();
  if (params.nodeId) query.set('node', params.nodeId);
  if (params.blockId) query.set('block', params.blockId);
  query.set('view', 'focus');
  return `/company-structure?${query.toString()}`;
}

export function asCompanyStructureHref(destination: NativeCompanyStructureDestination): Href {
  return destination as Href;
}
