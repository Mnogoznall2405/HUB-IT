/** Normalizes a legacy or external route into a safe in-app path. */
export function normalizeNativeRoutePath(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const raw = String(rawValue || '').trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/dashboard';
  }
  try {
    const parsed = new URL(raw, 'https://hubit.invalid');
    if (parsed.origin !== 'https://hubit.invalid') return '/dashboard';
    if (parsed.pathname === '/login' || parsed.pathname.startsWith('/api/')) return '/dashboard';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/dashboard';
  }
}
