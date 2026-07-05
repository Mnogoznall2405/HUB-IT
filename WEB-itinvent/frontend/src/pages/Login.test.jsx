import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  mockOfferPasswordSaveForAppleKeychain,
  mockSubmitSafariPasswordSaveFullPage,
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
  mockOfferPasswordSaveForAppleKeychain: vi.fn(),
  mockSubmitSafariPasswordSaveFullPage: vi.fn(),
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

vi.mock('../lib/passwordCredentialSave', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    offerPasswordSaveForAppleKeychain: (...args) => mockOfferPasswordSaveForAppleKeychain(...args),
    submitSafariPasswordSaveFullPage: (...args) => mockSubmitSafariPasswordSaveFullPage(...args),
  };
});

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

function installIphoneSafari() {
  installMatchMedia({ mobile: true });
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: 5,
  });
}

function primeTotpResumeFromSafariSave({
  challengeId = 'challenge-setup',
  username = 'ivanov',
  nextStep = 'totp_setup',
} = {}) {
  sessionStorage.setItem('hubit_totp_resume', JSON.stringify({
    loginChallengeId: challengeId,
    username,
    nextStep,
  }));
  window.location.search = `?resume_challenge=${encodeURIComponent(challengeId)}`;
}

async function ensurePasswordFormVisible() {
  return screen.findByTestId('password-auth-form');
}

describe('Login hybrid internal/external flow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    mockSubmitSafariPasswordSaveFullPage.mockReset();
    locationAssignMock.mockReset();
    locationReplaceMock.mockReset();

    mockQrToDataUrl.mockResolvedValue('data:image/png;base64,qr-image');
    mockOfferPasswordSaveForAppleKeychain.mockResolvedValue({
      offered: false,
      saved: false,
      reason: 'unsupported',
    });
    mockSubmitSafariPasswordSaveFullPage.mockReturnValue({ submitted: true, reason: 'full_page_post' });
    sessionStorage.clear();
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
    window.location.search = '';

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

  it('auto-confirms mobile 2FA setup after six digits and opens the trusted-device prompt', async () => {
    installMatchMedia({ mobile: true });
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123.0 Mobile Safari/537.36',
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux armv8l',
    });
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: false,
    });
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

    await screen.findByTestId('totp-open-authenticator');
    expect(screen.queryByRole('button', { name: 'Включить 2FA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подтвердить код' })).not.toBeInTheDocument();

    setInputValue('login-totp-setup-code', '123456');

    await waitFor(() => {
      expect(mockVerifyTwoFactorSetup).toHaveBeenCalledWith('challenge-setup', '123456');
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('redirects iPhone login through Safari password save bridge', async () => {
    installIphoneSafari();
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: false,
    });
    mockLogin.mockResolvedValue({
      success: true,
      status: '2fa_setup_required',
      login_challenge_id: 'challenge-setup',
      trusted_devices_available: false,
    });

    render(<Login />);
    await ensurePasswordFormVisible();
    submitPasswordStep();

    await waitFor(() => {
      expect(mockSubmitSafariPasswordSaveFullPage).toHaveBeenCalledWith({
        username: 'ivanov',
        password: 'secret',
        loginChallengeId: 'challenge-setup',
      });
    });
    expect(mockStartTwoFactorSetup).not.toHaveBeenCalled();
  });

  it('uses apple-otpauth button on iPhone during 2FA setup', async () => {
    installIphoneSafari();
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: false,
    });
    mockStartTwoFactorSetup.mockResolvedValue({
      success: true,
      login_challenge_id: 'challenge-setup',
      otpauth_uri: 'otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=hubit.zsgp.ru',
      manual_entry_key: 'ABC123',
      qr_svg: null,
    });
    primeTotpResumeFromSafariSave();

    render(<Login />);

    await waitFor(() => {
      expect(mockStartTwoFactorSetup).toHaveBeenCalledWith('challenge-setup');
    });

    const appleButton = await screen.findByTestId('totp-open-apple-passwords');
    expect(appleButton).toBeEnabled();
    expect(screen.getByText(/QR-код и ручной ключ/i)).toBeInTheDocument();
    expect(screen.queryByTestId('totp-open-authenticator')).not.toBeInTheDocument();
  });

  it('shows compact 2FA setup on iPhone without password-save helpers', async () => {
    installIphoneSafari();
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: false,
    });
    mockStartTwoFactorSetup.mockResolvedValue({
      success: true,
      login_challenge_id: 'challenge-setup',
      otpauth_uri: 'otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=hubit.zsgp.ru',
      manual_entry_key: 'ABC123',
      qr_svg: null,
    });
    primeTotpResumeFromSafariSave();

    render(<Login />);

    await waitFor(() => {
      expect(mockStartTwoFactorSetup).toHaveBeenCalledWith('challenge-setup');
    });

    expect(await screen.findByTestId('totp-open-apple-passwords')).toBeInTheDocument();
    expect(screen.queryByTestId('totp-save-password-to-keychain')).not.toBeInTheDocument();
    expect(screen.queryByTestId('totp-confirm-password-saved')).not.toBeInTheDocument();
    expect(screen.getByText(/QR-код и ручной ключ/i)).toBeInTheDocument();
  });

  it('does not auto-attempt passkey until WebAuthn API is available', async () => {
    delete window.PublicKeyCredential;

    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: true,
    });
    mockStartPasskeyLogin.mockResolvedValue({
      success: false,
      error: 'Deferred passkey test',
    });

    render(<Login />);

    await waitFor(() => {
      expect(mockGetLoginMode).toHaveBeenCalled();
    });
    expect(mockStartPasskeyLogin).not.toHaveBeenCalled();

    window.PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
    };
    window.dispatchEvent(new Event('hubit:webauthn-ready'));

    await waitFor(() => {
      expect(mockStartPasskeyLogin).toHaveBeenCalledTimes(1);
    });
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
    expect(screen.getByTestId('password-auth-form')).toBeInTheDocument();
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

  it('offers optional enrollment prompt after external 2FA when discoverable trusted device already exists', async () => {
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

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/другом устройстве/i)).toBeInTheDocument();
    expect(locationAssignMock).not.toHaveBeenCalled();

    const dialogButtons = within(dialog).getAllByRole('button');
    fireEvent.click(dialogButtons[0]);

    await waitFor(() => {
      expect(locationAssignMock).toHaveBeenCalledWith('/dashboard');
    });
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
    const details = screen.getByText('QR-код и ручной ключ').closest('details');
    expect(details).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('QR-код и ручной ключ'));
    expect(details).toHaveAttribute('open');
    expect(await screen.findByTestId('totp-qr-image')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByTestId('totp-copy-manual-key')).toBeInTheDocument();

    setInputValue('login-totp-setup-code', '123456');
    fireEvent.submit(document.getElementById('login-totp-setup-code').closest('form'));

    expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('setup-complete-continue'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(locationAssignMock).not.toHaveBeenCalled();
  });
});
