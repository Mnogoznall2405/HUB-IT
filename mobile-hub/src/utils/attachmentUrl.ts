import { API_V1_BASE } from '../api/config';

export function resolveAttachmentUrl(url?: string | null): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const origin = API_V1_BASE.replace(/\/api\/v1\/?$/, '');
  try {
    const resolved = new URL(raw, `${origin}/`);
    if (resolved.origin !== new URL(origin).origin) return null;
    if (!['https:', 'http:'].includes(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}
