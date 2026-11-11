export function createMailSendIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `mail-send-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function withMailSendIdempotencyHeaders(headers = {}, idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return headers;
  return {
    ...headers,
    'Idempotency-Key': key,
  };
}

export function takeMailSendIdempotencyKey(payload = {}, options = {}) {
  const key = String(options.idempotencyKey || payload?.idempotencyKey || '').trim();
  const body = { ...(payload || {}) };
  delete body.idempotencyKey;
  return { key, body };
}
