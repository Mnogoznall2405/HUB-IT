import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// FE-0197/FE-0198: Login must acquire the post-auth UI hold before any auth
// operation commits the user object, keep it until the post-auth UI finishes,
// and release it on every failure/exit path.

const {
  mockLogin,
  mockStartTwoFactorSetup,
  mockVerifyTwoFactorSetup,
  mockVerifyTwoFactorLogin,
  mockStartPasskeyLogin,
  mockVerifyPasskeyLogin,
  mockRefreshTrustedDeviceAuth,
  mockVerifyTrustedDeviceAuth,
  mockSetPostAuthUiHold,
  mockGetLoginMode,
  mockGetTrustedDeviceRegistrationOptions,
  mockVerifyTrustedDeviceRegistration,
  mockQrToDataUrl,
  locationAssignMock,
  locationReplaceMock,
  mockGetDesktopWindowsUsername,
  mockIsDesktopBridgeReady,
  mockGetAuthorizeUrl,
} = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockStartTwoFactorSetup: vi.fn(),
  mockVerifyTwoFactorSetup: vi.fn(),
  mockVerifyTwoFactorLogin: vi.fn(),
  mockStartPasskeyLogin: vi.fn(),
  mockVerifyPasskeyLogin: vi.fn(),
  mockRefreshTrustedDeviceAuth: vi.fn(),
  mockVerifyTrustedDeviceAuth: vi.fn(),
  mockSetPostAuthUiHold: vi.fn(),
  mockGetLoginMode: vi.fn(),
  mockGetTrustedDeviceRegistrationOptions: vi.fn(),
  mockVerifyTrustedDeviceRegistration: vi.fn(),
  mockQrToDataUrl: vi.fn(),
  locationAssignMock: vi.fn(),
  locationReplaceMock: vi.fn(),
  mockGetDesktopWindowsUsername: vi.fn(),
  mockIsDesktopBridgeReady: vi.fn(() => false),
  mockGetAuthorizeUrl: vi.fn(),
}));

vi.mock('../api/windowsSso', () => ({
  windowsSsoAPI: {
    getAuthorizeUrl: mockGetAuthorizeUrl,
  },
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
    setPostAuthUiHold: mockSetPostAuthUiHold,
  }),
}));

vi.mock('../api/auth', () => ({
  authAPI: {
    getLoginMode: mockGetLoginMode,
    getTrustedDeviceRegistrationOptions: mockGetTrustedDeviceRegistrationOptions,
    verifyTrustedDeviceRegistration: mockVerifyTrustedDeviceRegistration,
  },
}));

vi.mock('../lib/desktopBridge', () => ({
  getDesktopWindowsUsername: mockGetDesktopWindowsUsername,
  isDesktopBridgeReady: (...args) => mockIsDesktopBridgeReady(...args),
}));

vi.mock('../components/desktop/DesktopInstallerDownload', () => ({
  default: () => <div data-testid="desktop-installer-download" />,
}));

vi.mock('../components/mobile/MobileInstallerDownload', () => ({
  default: () => <div data-testid="mobile-installer-download" />,
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

function holdCalls() {
  return mockSetPostAuthUiHold.mock.calls.map(([value]) => value);
}

describe('Login post-auth UI hold (FE-0197/FE-0198/FE-0199)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    [
      mockLogin, mockStartTwoFactorSetup, mockVerifyTwoFactorSetup, mockVerifyTwoFactorLogin,
      mockStartPasskeyLogin, mockVerifyPasskeyLogin, mockRefreshTrustedDeviceAuth,
      mockVerifyTrustedDeviceAuth, mockSetPostAuthUiHold, mockGetLoginMode,
      mockGetTrustedDeviceRegistrationOptions, mockVerifyTrustedDeviceRegistration,
      mockQrToDataUrl, locationAssignMock, locationReplaceMock,
      mockGetDesktopWindowsUsername, mockIsDesktopBridgeReady, mockGetAuthorizeUrl,
    ].forEach((fn) => fn.mockReset());
    mockGetDesktopWindowsUsername.mockReturnValue('');
    mockIsDesktopBridgeReady.mockReturnValue(false);
    mockQrToDataUrl.mockResolvedValue('data:image/png;base64,qr-image');
    sessionStorage.clear();
    localStorage.clear();
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'internal',
      biometric_login_enabled: false,
      client_country_code: 'RU',
      show_vpn_hint: false,
    });
    installMatchMedia({ mobile: false });
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0',
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
    window.navigator.credentials = { create: vi.fn(), get: vi.fn() };
    window.PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
    };
  });

  it('keeps the backup-codes screen visible after 2FA setup verify and lifts the hold only on continue (FE-0197)', async () => {
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
      user: { id: 7, username: 'ivanov', role: 'viewer', permissions: [] },
      backup_codes: ['AAAA-BBBB', 'CCCC-DDDD'],
    });

    render(<Login />);
    await screen.findByTestId('password-auth-form');
    submitPasswordStep();

    await waitFor(() => {
      expect(document.getElementById('login-totp-setup-code')).not.toBeNull();
    });
    setInputValue('login-totp-setup-code', '123456');
    await act(async () => {
      fireEvent.submit(document.getElementById('login-totp-setup-code').closest('form'));
    });

    expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument();
    expect(screen.getByText('CCCC-DDDD')).toBeInTheDocument();
    // The hold was acquired before the user was committed and is still held
    // while the backup codes are on screen — LoginRoute must not navigate away.
    // (An earlier true→false pair covers the pre-auth 2FA challenge step.)
    const calls = holdCalls();
    expect(calls).toContain(true);
    expect(calls[calls.length - 1]).toBe(true);
    expect(locationAssignMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('setup-complete-continue'));
    });

    await waitFor(() => {
      expect(holdCalls()).toContain(false);
    });
    expect(locationAssignMock).toHaveBeenCalled();
  });

  it('keeps the required trusted-device prompt visible after 2FA login until the user dismisses it (FE-0198/FE-0199)', async () => {
    mockGetLoginMode.mockResolvedValue({
      network_zone: 'external',
      biometric_login_enabled: false,
    });
    mockLogin.mockResolvedValue({
      success: true,
      status: '2fa_required',
      login_challenge_id: 'challenge-login',
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
        about_onboarding_completed_at: '2026-08-13T10:00:00Z',
      },
    });

    render(<Login />);
    await screen.findByTestId('password-auth-form');
    submitPasswordStep();

    await screen.findByTestId('verify-fallback-form');
    setInputValue('login-totp-verify', '123456');
    await act(async () => {
      fireEvent.submit(screen.getByTestId('verify-fallback-form'));
    });

    const dialog = await screen.findByTestId('login-remember-device-dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'remember-device-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'remember-device-hint');
    expect(document.getElementById('remember-device-hint')).toBeInTheDocument();
    // Background content is inert while the prompt is open.
    expect(document.querySelector('[inert]')).not.toBeNull();
    expect(holdCalls()).toContain(true);
    expect(locationAssignMock).not.toHaveBeenCalled();

    // Escape dismisses the (unsupported-mode) prompt and completes navigation.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('login-remember-device-dialog')).not.toBeInTheDocument();
    });
    expect(holdCalls()).toContain(false);
    expect(locationAssignMock).toHaveBeenCalled();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('releases the hold when the password login fails', async () => {
    mockLogin.mockResolvedValue({ success: false, error: 'invalid_credentials' });

    render(<Login />);
    await screen.findByTestId('password-auth-form');
    await act(async () => {
      submitPasswordStep();
    });

    await waitFor(() => {
      expect(holdCalls()).toEqual([true, false]);
    });
  });

  it('releases the hold when 2FA verification fails', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      status: '2fa_required',
      login_challenge_id: 'challenge-login',
      trusted_devices_available: false,
    });
    mockVerifyTwoFactorLogin.mockResolvedValue({ success: false, error: 'Неверный код' });

    render(<Login />);
    await screen.findByTestId('password-auth-form');
    submitPasswordStep();

    await screen.findByTestId('verify-fallback-form');
    setInputValue('login-totp-verify', '000000');
    await act(async () => {
      fireEvent.submit(screen.getByTestId('verify-fallback-form'));
    });

    await waitFor(() => {
      expect(screen.getByText('Неверный код')).toBeInTheDocument();
    });
    const calls = holdCalls();
    expect(calls[calls.length - 1]).toBe(false);
    expect(locationAssignMock).not.toHaveBeenCalled();
  });
});
