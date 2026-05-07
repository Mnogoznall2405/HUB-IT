export function b64urlToBuffer(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export function bufferToB64url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function encodeCredential(credential) {
  if (!credential) return null;
  const response = credential.response || {};
  return {
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: response.clientDataJSON ? bufferToB64url(response.clientDataJSON) : undefined,
      attestationObject: response.attestationObject ? bufferToB64url(response.attestationObject) : undefined,
      authenticatorData: response.authenticatorData ? bufferToB64url(response.authenticatorData) : undefined,
      signature: response.signature ? bufferToB64url(response.signature) : undefined,
      userHandle: response.userHandle ? bufferToB64url(response.userHandle) : undefined,
      transports: typeof response.getTransports === 'function' ? response.getTransports() : undefined,
    },
  };
}

export function normalizeRegistrationOptions(publicKey) {
  return {
    ...publicKey,
    challenge: b64urlToBuffer(publicKey.challenge),
    user: {
      ...publicKey.user,
      id: b64urlToBuffer(publicKey.user.id),
    },
    excludeCredentials: Array.isArray(publicKey.excludeCredentials)
      ? publicKey.excludeCredentials.map((item) => ({
        ...item,
        id: b64urlToBuffer(item.id),
      }))
      : [],
  };
}

export function normalizeAuthenticationOptions(publicKey) {
  const normalized = {
    ...publicKey,
    challenge: b64urlToBuffer(publicKey.challenge),
  };
  if (Array.isArray(publicKey.allowCredentials) && publicKey.allowCredentials.length > 0) {
    normalized.allowCredentials = publicKey.allowCredentials.map((item) => ({
      ...item,
      id: b64urlToBuffer(item.id),
    }));
  }
  return normalized;
}
