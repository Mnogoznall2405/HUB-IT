const DEBUG_SESSION_ID = '891634';
const LOCAL_INGEST_URL = 'http://127.0.0.1:7567/ingest/0dd98d48-9716-48e2-8a2d-050e49aa7cea';

const buildRelayUrl = () => {
  const rawBase = String(import.meta.env.BASE_URL || '/');
  const normalizedBase = rawBase === './' || rawBase === '.' ? '/' : rawBase;
  const basePrefix = normalizedBase.endsWith('/') && normalizedBase.length > 1
    ? normalizedBase.slice(0, -1)
    : normalizedBase;
  const derivedApiBase = basePrefix === '/' ? '/api' : `${basePrefix}/api`;
  const apiBase = import.meta.env.VITE_API_URL || derivedApiBase;
  return `${apiBase}/v1/debug/client-log`;
};

export function emitAgentDebugLog(entry = {}) {
  if (typeof window === 'undefined') return;

  const payload = {
    sessionId: DEBUG_SESSION_ID,
    timestamp: Date.now(),
    ...entry,
  };
  const headers = {
    'Content-Type': 'application/json',
    'X-Debug-Session-Id': DEBUG_SESSION_ID,
  };
  const body = JSON.stringify(payload);

  fetch(LOCAL_INGEST_URL, {
    method: 'POST',
    headers,
    body,
    keepalive: true,
  }).catch(() => {});

  fetch(buildRelayUrl(), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
    keepalive: true,
  }).catch(() => {});
}
