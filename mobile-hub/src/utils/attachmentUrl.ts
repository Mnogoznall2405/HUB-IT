import { API_V1_BASE } from '../api/config';

export function resolveAttachmentUrl(url?: string | null): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const origin = API_V1_BASE.replace(/\/api\/v1\/?$/, '');
  return `${origin}${raw.startsWith('/') ? raw : `/${raw}`}`;
}
