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

function isAgentDebugLoggingEnabled() {
  if (typeof window === 'undefined') return false;
  if (import.meta.env?.DEV) return true;
  try {
    return window.localStorage?.getItem('agentDebugLog') === '1';
  } catch {
    return false;
  }
}

export function emitAgentDebugLog(entry = {}) {
  if (!isAgentDebugLoggingEnabled()) return;

  const payload = {
    timestamp: Date.now(),
    ...entry,
  };
  const headers = {
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify(payload);

  if (import.meta.env.DEV) {
    void import('./debugClientLog.dev.js')
      .then(({ DEBUG_SESSION_ID, LOCAL_INGEST_URL }) => {
        const devPayload = { ...payload, sessionId: DEBUG_SESSION_ID };
        const devHeaders = { ...headers, 'X-Debug-Session-Id': DEBUG_SESSION_ID };
        fetch(LOCAL_INGEST_URL, {
          method: 'POST',
          headers: devHeaders,
          body: JSON.stringify(devPayload),
          keepalive: true,
        }).catch(() => {});
      })
      .catch(() => {});
  }

  fetch(buildRelayUrl(), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
    keepalive: true,
  }).catch(() => {});
}
