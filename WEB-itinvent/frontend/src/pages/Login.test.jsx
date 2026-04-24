import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLogin,
  mockStartTwoFactorSetup,
  mockVerifyTwoFactorSetup,
  mockVerifyTwoFactorLogin,
  mockStartPasskeyLogin,
  mockVerifyPasskeyLogin,
  mockRefreshTrustedDeviceAuth,
  mockVerifyTrustedDeviceAuth,
  mockGetLoginMode,
  mockGetTrustedDeviceRegistrationOptions,
  mockVerifyTrustedDeviceRegistration,
  mockQrToDataUrl,
  locationAssignMock,
  locationReplaceMock,
} = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockStartTwoFactorSetup: vi.fn(),
  mockVerifyTwoFactorSetup: vi.fn(),
  mockVerifyTwoFactorLogin: vi.fn(),
  mockStartPasskeyLogin: vi.fn(),
  mockVerifyPasskeyLogin: vi.fn(),
  mockRefreshTrustedDeviceAuth: vi.fn(),
  mockVerifyTrustedDeviceAuth: vi.fn(),
  mockGetLoginMode: vi.fn(),
  mockGetTrustedDeviceRegistrationOptions: vi.fn(),
  mockVerifyTrustedDeviceRegistration: vi.fn(),
  mockQrToDataUrl: vi.fn(),
  locationAssignMock: vi.fn(),
  locationReplaceMock: vi.fn(),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: mockQrToDataUrl,
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    startTwoFactorSetup: mockStartTwoFactorSetup,
    verifyTwoFactorSetup: mockVerifyTwoFactorSetup,
    verifyTwoFactorLogin: mockVerifyTwoFactorLogin,
    startPasskeyLogin: mockStartPasskeyLogin,
    verifyPasskeyLogin: mockVerifyPasskeyLogin,
    refreshTrustedDeviceAuth: mockRefreshTrustedDeviceAuth,
    verifyTrustedDeviceAuth: mockVerifyTrustedDeviceAuth,
  }),
}));

vi.mock('../api/client', () => ({
  authAPI: {
    getLoginMode: mockGetLoginMode,
    getTrustedDeviceRegistrationOptions: mockGetTrustedDeviceRegistrationOptions,
    verifyTrustedDeviceRegistration: mockVerifyTrustedDeviceRegistration,
  },
}));

import Login from './Login';

function installMatchMedia({ mobile = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mobile ? query.includes('max-width: 767px') : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function makeBuffer(values) {
  return new Uint8Array(values).buffer;
}

function makeAuthCredential() {
  return {
    id: 'cred-1',
    rawId: makeBuffer([1, 2, 3]),
    type: 'public-key',
    response: {
      clientDataJSON: makeBuffer([4, 5, 6]),
      authenticatorData: makeBuffer([7, 8, 9]),
      signature: makeBuffer([10, 11, 12]),
      userHandle: null,
    },
  };
}

function makeNotAllowedError(message = 'Cancelled') {
  const error = new Error(message);
  error.name = 'NotAllowedError';
  return error;
}

function setInputValue(id, value) {
  const input = document.getElementById(id);
  if (!input) {
    throw new Error(`Input not found: ${id}`);
  }
  fireEvent.change(input, { target: { value } });
}

function submitPasswordStep({ username = 'ivanov', password = 'secret' } = {}) {
  setInputValue('login-username', username);
  setInputValue('login-password', password);
  fireEvent.submit(screen.getByTestId('password-auth-form'));
}

async function ensurePasswordFormVisible() {
  return screen.findByTestId('password-auth-form');
}

describe('Login hybrid internal/external flow', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockStartTwoFactorSetup.mockReset();
    mockVerifyTwoFactorSetup.mockReset();
    mockVerifyTwoFactorLogin.mockReset();
    mockStartPasskeyLogin.mockReset();
    mockVerifyPasskeyLogin.mockReset();
    mockRefreshTrustedDeviceAuth.mockReset();
    mockVerifyTrustedDeviceAuth.mockReset();
    mockGetLoginMode.mockReset();
    mockGetTrustedDeviceRegistrationOptions.mockReset();
    mockVerifyTrustedDeviceRegistration.mockReset();
    mockQrToDataUrl.mockReset();
    locationAssignMock.mockReset();
    locationReplaceMock.mockReset();

    mockQrToDataUrl.mockResolvedValue('data:image/png;base64,qr-image');
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'internal',
      biometric_login_enabled: false,
    });

    installMatchMedia({ mobile: false });
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        assign: locationAssignMock,
        replace: locationReplaceMock,
        hostname: 'localhost',
        protocol: 'http:',
        pathname: '/login',
        search: '',
        hash: '',
      },
    });

    window.navigator.credentials = {
      create: vi.fn(),
      get: vi.fn(),
    };
    window.PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
    };
  });

  it('shows password form immediately for internal network and does not start passkey flow', async () => {
    render(<Login />);

    expect(await screen.findByTestId('login-desktop-layout')).toBeInTheDocument();
    expect(await ensurePasswordFormVisible()).toBeInTheDocument();
    expect(screen.queryByTestId('biometric-hero-button')).not.toBeInTheDocument();
    expect(mockGetLoginMode).toHaveBeenCalledTimes(1);
    expect(mockStartPasskeyLogin).not.toHaveBeenCalled();
  });

  it('renders mobile login shell with the primary password action reachable', async () => {
    installMatchMedia({ mobile: true });

    render(<Login />);

    expect(await screen.findByTestId('login-mobile-layout')).toBeInTheDocument();
    expect(await ensurePasswordFormVisible()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
  });

  it('auto-attempts passkey login for external network and redirects on success', async () => {
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: true,
    });
    mockStartPasskeyLogin.mockResolvedValue({
      success: true,
      challenge_id: 'passkey-challenge-1',
      public_key: {
        challenge: 'AQID',
        rpId: 'hubit.zsgp.ru',
        timeout: 12000,
        userVerification: 'required',
      },
    });
    window.navigator.credentials.get.mockResolvedValue(makeAuthCredential());
    mockVerifyPasskeyLogin.mockResolvedValue({
      success: true,
      status: 'authenticated',
      user: {
        id: 7,
        username: 'ivanov',
        role: 'viewer',
        permissions: [],
      },
    });

    render(<Login />);

    await waitFor(() => {
      expect(mockStartPasskeyLogin).toHaveBeenCalledTimes(1);
      expect(mockVerifyPasskeyLogin).toHaveBeenCalledTimes(1);
      expect(locationAssignMock).toHaveBeenCalledWith('/dashboard');
    });
    expect(screen.queryByTestId('password-auth-form')).not.toBeInTheDocument();
  });

  it('reveals password fallback after external biometric cancellation', async () => {
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: true,
    });
    mockStartPasskeyLogin.mockResolvedValue({
      success: true,
      challenge_id: 'passkey-challenge-1',
      public_key: {
        challenge: 'AQID',
        rpId: 'hubit.zsgp.ru',
        timeout: 12000,
        userVerification: 'required',
      },
    });
    window.navigator.credentials.get.mockRejectedValue(makeNotAllowedError());

    render(<Login />);

    expect(await ensurePasswordFormVisible()).toBeInTheDocument();
    expect(mockStartPasskeyLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('biometric-hero-button')).toBeInTheDocument();
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('keeps 2FA verify code-only and opens mandatory enrollment prompt for external user without discoverable device', async () => {
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: true,
    });
    mockStartPasskeyLogin.mockResolvedValue({
      success: true,
      challenge_id: 'passkey-challenge-1',
      public_key: {
        challenge: 'AQID',
        rpId: 'hubit.zsgp.ru',
        timeout: 12000,
        userVerification: 'required',
      },
    });
    window.navigator.credentials.get.mockRejectedValue(makeNotAllowedError());
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(true);
    mockLogin.mockResolvedValue({
      success: true,
      status: '2fa_required',
      login_challenge_id: 'challenge-verify',
      trusted_devices_available: true,
    });
    mockVerifyTwoFactorLogin.mockResolvedValue({
      success: true,
      status: 'authenticated',
      user: {
        id: 7,
        username: 'ivanov',
        role: 'viewer',
        permissions: [],
        network_zone: 'external',
        discoverable_trusted_devices_count: 0,
      },
    });

    render(<Login />);
    await ensurePasswordFormVisible();
    submitPasswordStep();

    expect(await screen.findByTestId('verify-fallback-form')).toBeInTheDocument();
    expect(screen.queryByTestId('biometric-hero-button')).not.toBeInTheDocument();

    setInputValue('login-totp-verify', '654321');
    fireEvent.submit(screen.getByTestId('verify-fallback-form'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('allows unsupported external enrollment prompt to continue into the app', async () => {
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: true,
    });
    mockStartPasskeyLogin.mockResolvedValue({
      success: true,
      challenge_id: 'passkey-challenge-1',
      public_key: {
        challenge: 'AQID',
        rpId: 'hubit.zsgp.ru',
        timeout: 12000,
        userVerification: 'required',
      },
    });
    window.navigator.credentials.get.mockRejectedValue(makeNotAllowedError());
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(false);
    mockLogin.mockResolvedValue({
      success: true,
      status: '2fa_required',
      login_challenge_id: 'challenge-verify',
      trusted_devices_available: false,
    });
    mockVerifyTwoFactorLogin.mockResolvedValue({
      success: true,
      status: 'authenticated',
      user: {
        id: 7,
        username: 'ivanov',
        role: 'viewer',
        permissions: [],
        network_zone: 'external',
        discoverable_trusted_devices_count: 0,
      },
    });

    render(<Login />);
    await ensurePasswordFormVisible();
    submitPasswordStep();

    await screen.findByTestId('verify-fallback-form');
    setInputValue('login-totp-verify', '654321');
    fireEvent.submit(await screen.findByTestId('verify-fallback-form'));

    const dialog = await screen.findByRole('dialog');
    const dialogButtons = within(dialog).getAllByRole('button');
    fireEvent.click(dialogButtons[0]);

    await waitFor(() => {
      expect(locationAssignMock).toHaveBeenCalledWith('/dashboard');
    });
    expect(mockGetTrustedDeviceRegistrationOptions).not.toHaveBeenCalled();
  });

  it('skips enrollment prompt after external 2FA when discoverable trusted device already exists', async () => {
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: true,
    });
    mockStartPasskeyLogin.mockResolvedValue({
      success: true,
      challenge_id: 'passkey-challenge-1',
      public_key: {
        challenge: 'AQID',
        rpId: 'hubit.zsgp.ru',
        timeout: 12000,
        userVerification: 'required',
      },
    });
    window.navigator.credentials.get.mockRejectedValue(makeNotAllowedError());
    mockLogin.mockResolvedValue({
      success: true,
      status: '2fa_required',
      login_challenge_id: 'challenge-verify',
      trusted_devices_available: false,
    });
    mockVerifyTwoFactorLogin.mockResolvedValue({
      success: true,
      status: 'authenticated',
      user: {
        id: 7,
        username: 'ivanov',
        role: 'viewer',
        permissions: [],
        network_zone: 'external',
        discoverable_trusted_devices_count: 1,
      },
    });

    render(<Login />);
    await ensurePasswordFormVisible();
    submitPasswordStep();

    await screen.findByTestId('verify-fallback-form');
    setInputValue('login-totp-verify', '654321');
    fireEvent.submit(await screen.findByTestId('verify-fallback-form'));

    await waitFor(() => {
      expect(locationAssignMock).toHaveBeenCalledWith('/dashboard');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps backup-code completion and opens enrollment prompt before redirect for external first setup', async () => {
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: true,
    });
    mockStartPasskeyLogin.mockResolvedValue({
      success: true,
      challenge_id: 'passkey-challenge-1',
      public_key: {
        challenge: 'AQID',
        rpId: 'hubit.zsgp.ru',
        timeout: 12000,
        userVerification: 'required',
      },
    });
    window.navigator.credentials.get.mockRejectedValue(makeNotAllowedError());
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(true);
    mockLogin.mockResolvedValue({
      success: true,
      status: '2fa_setup_required',
      login_challenge_id: 'challenge-setup',
      trusted_devices_available: false,
    });
    mockStartTwoFactorSetup.mockResolvedValue({
      success: true,
      login_challenge_id: 'challenge-setup',
      otpauth_uri: 'otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=HUB-IT',
      manual_entry_key: 'ABC123',
      qr_svg: null,
    });
    mockVerifyTwoFactorSetup.mockResolvedValue({
      success: true,
      status: 'authenticated',
      user: {
        id: 7,
        username: 'ivanov',
        role: 'viewer',
        permissions: [],
        network_zone: 'external',
        discoverable_trusted_devices_count: 0,
      },
      backup_codes: ['AAAA-BBBB'],
    });

    render(<Login />);
    await ensurePasswordFormVisible();
    submitPasswordStep();

    const otpauthUri = 'otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=HUB-IT';
    const openAuthenticatorLink = await screen.findByTestId('totp-open-authenticator');
    expect(openAuthenticatorLink).toHaveAttribute('href', otpauthUri);
    expect(await screen.findByTestId('totp-qr-image')).toBeInTheDocument();
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(otpauthUri)).not.toBeInTheDocument();
    expect(screen.queryByTestId('totp-manual-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('totp-manual-toggle'));
    expect(screen.getByTestId('totp-manual-panel')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByDisplayValue(otpauthUri)).toBeInTheDocument();
    expect(screen.getByTestId('totp-copy-manual-key')).toBeInTheDocument();
    expect(screen.getByTestId('totp-copy-uri')).toBeInTheDocument();

    setInputValue('login-totp-setup-code', '123456');
    fireEvent.submit(document.getElementById('login-totp-setup-code').closest('form'));

    expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('setup-complete-continue'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(locationAssignMock).not.toHaveBeenCalled();
  });
});
