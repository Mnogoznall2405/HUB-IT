// Diagnostic trail of the call lifecycle in the browser console (`[calls]`).
// Only ids, stages and error codes: never tokens, URLs with credentials or media data.

const SAFE_KEYS = new Set([
  'callId', 'conversationId', 'media', 'role', 'status', 'endReason', 'stage', 'code',
  'reason', 'name', 'chunk', 'rooms', 'aborted', 'local', 'phase', 'source',
]);

export function callLog(stage, details = {}) {
  try {
    const safe = {};
    Object.keys(details || {}).forEach((key) => {
      if (!SAFE_KEYS.has(key)) return;
      const value = details[key];
      safe[key] = typeof value === 'string' ? value.slice(0, 120) : value;
    });
    console.warn('[calls]', stage, safe);
  } catch {
    // Logging must never affect the call.
  }
}
