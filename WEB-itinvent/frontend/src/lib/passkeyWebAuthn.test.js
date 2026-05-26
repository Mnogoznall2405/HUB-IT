import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPasskeyCredential,
  getPasskeyAssertion,
  isUserCancelledWebAuthnError,
} from './passkeyWebAuthn';

const registrationOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { name: 'HUB-IT', id: 'hubit.zsgp.ru' },
  user: { id: 'dXNlcg', name: 'user', displayName: 'User' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  excludeCredentials: [],
};

function installWebAuthnMocks() {
  const credentials = {
    create: vi.fn(async () => ({
      id: 'cred-webview',
      rawId: new ArrayBuffer(8),
      type: 'public-key',
      response: {
        clientDataJSON: new ArrayBuffer(8),
        attestationObject: new ArrayBuffer(8),
      },
    })),
    get: vi.fn(async () => ({
      id: 'cred-get',
      rawId: new ArrayBuffer(8),
      type: 'public-key',
      response: {
        clientDataJSON: new ArrayBuffer(8),
        authenticatorData: new ArrayBuffer(8),
        signature: new ArrayBuffer(8),
      },
    })),
  };
  window.PublicKeyCredential = function PublicKeyCredential() {};
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    value: credentials,
  });
  return credentials;
}

describe('passkeyWebAuthn', () => {
  let credentials;

  beforeEach(() => {
    credentials = installWebAuthnMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects user-cancelled WebAuthn errors', () => {
    expect(isUserCancelledWebAuthnError({ name: 'NotAllowedError' })).toBe(true);
    expect(isUserCancelledWebAuthnError({ name: 'AbortError' })).toBe(true);
    expect(isUserCancelledWebAuthnError({ name: 'InvalidStateError' })).toBe(false);
  });

  it('creates passkeys via WebView credentials API', async () => {
    const credential = await createPasskeyCredential(registrationOptions);
    expect(credentials.create).toHaveBeenCalledTimes(1);
    expect(credential?.id).toBe('cred-webview');
  });

  it('gets passkey assertions via WebView credentials API', async () => {
    const credential = await getPasskeyAssertion({
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'hubit.zsgp.ru',
    });
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(credential?.id).toBe('cred-get');
  });
});
