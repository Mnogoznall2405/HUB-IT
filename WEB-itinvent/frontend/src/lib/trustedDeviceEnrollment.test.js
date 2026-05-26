import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultTrustedDeviceLabel,
  extractWebAuthnErrorMessage,
  registerTrustedDevice,
} from './trustedDeviceEnrollment';

vi.mock('./passkeyWebAuthn', () => ({
  createPasskeyCredential: vi.fn(async () => ({ id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} })),
  encodeCredential: vi.fn((value) => value),
  isPasskeySurfaceAvailable: vi.fn(async () => false),
}));

describe('trustedDeviceEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds an Android label from user agent', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux armv8l',
    });
    expect(buildDefaultTrustedDeviceLabel()).toContain('Android');
  });

  it('registers a trusted device through auth API helpers', async () => {
    const authAPI = {
      getTrustedDeviceRegistrationOptions: vi.fn(async () => ({
        challenge_id: 'challenge-1',
        public_key: { challenge: 'AQID', rp: { id: 'hubit.zsgp.ru', name: 'HUB-IT' } },
      })),
      verifyTrustedDeviceRegistration: vi.fn(async () => ({ id: 'device-1' })),
    };

    await registerTrustedDevice({
      authAPI,
      label: 'Phone B',
      platformOnly: false,
    });

    expect(authAPI.getTrustedDeviceRegistrationOptions).toHaveBeenCalledWith('Phone B', { platformOnly: false });
    expect(authAPI.verifyTrustedDeviceRegistration).toHaveBeenCalledWith(
      'challenge-1',
      expect.objectContaining({ id: 'cred-1' }),
      'Phone B',
    );
  });

  it('maps InvalidStateError to a friendly message', () => {
    expect(extractWebAuthnErrorMessage({ name: 'InvalidStateError' }, 'fallback')).toMatch(/уже запомнено/i);
  });
});
