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

function isLocalIngestEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    // Opt-in only: browsers still log net::ERR_CONNECTION_REFUSED even when fetch().catch() is used.
    return window.localStorage?.getItem('agentDebugIngest') === '1';
  } catch {
    return false;
  }
}

export function emitAgentDebugLog(entry = {}, options = {}) {
  // Do NOT force-emit in production: under multi-user load this stampedes /debug/client-log
  // and starves mail/chat. Opt-in via localStorage.agentDebugLog=1 or Vite DEV.
  // `force: true` is for short-lived debug sessions only.
  if (!options?.force && !isAgentDebugLoggingEnabled()) return;

  const payload = {
    timestamp: Date.now(),
    sessionId: '20cb37',
    ...entry,
  };
  const headers = {
    'Content-Type': 'application/json',
    'X-Debug-Session-Id': '20cb37',
  };
  const body = JSON.stringify(payload);

  // Local Cursor ingest is opt-in (`agentDebugIngest=1`) to avoid console spam when :7785 is down.
  if (isLocalIngestEnabled()) {
    // #region agent log
    fetch('http://127.0.0.1:7785/ingest/0b41f4b9-4bc6-4338-b7ef-ba558019ce59', {
      method: 'POST',
      headers,
      body,
      keepalive: true,
    }).catch(() => {});
    // #endregion

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
  }

  fetch(buildRelayUrl(), {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
    keepalive: true,
  }).catch(() => {});

  try {
    const key = '__agentDebugLogRing';
    const ring = Array.isArray(window[key]) ? window[key] : [];
    ring.push(payload);
    window[key] = ring.slice(-200);
  } catch {
    // ignore
  }
}
