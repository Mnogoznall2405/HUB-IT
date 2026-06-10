import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetEntries,
  mockCreateEntry,
  mockGetGroups,
  mockUpdateEntry,
  mockArchiveEntry,
  mockUnlock,
  mockUnlockWebAuthnOptions,
  mockUnlockWebAuthnVerify,
  mockGetPasskeyAssertion,
  mockRevealEntry,
  mockGetAudit,
  mockHasPermission,
  mockNotifySuccess,
  mockNotifyWarning,
  mockNotifyApiError,
  mockUseMediaQuery,
} = vi.hoisted(() => ({
  mockGetEntries: vi.fn(),
  mockGetGroups: vi.fn(),
  mockCreateEntry: vi.fn(),
  mockUpdateEntry: vi.fn(),
  mockArchiveEntry: vi.fn(),
  mockUnlock: vi.fn(),
  mockUnlockWebAuthnOptions: vi.fn(),
  mockUnlockWebAuthnVerify: vi.fn(),
  mockGetPasskeyAssertion: vi.fn(),
  mockRevealEntry: vi.fn(),
  mockGetAudit: vi.fn(),
  mockHasPermission: vi.fn((permission) => ['passwords.read', 'passwords.write'].includes(permission)),
  mockNotifySuccess: vi.fn(),
  mockNotifyWarning: vi.fn(),
  mockNotifyApiError: vi.fn(),
  mockUseMediaQuery: vi.fn(() => false),
}));

vi.mock('@mui/material/useMediaQuery', () => ({
  default: mockUseMediaQuery,
}));

vi.mock('../api/passwords', () => ({
  passwordsAPI: {
    getEntries: mockGetEntries,
    getGroups: mockGetGroups,
    createEntry: mockCreateEntry,
    updateEntry: mockUpdateEntry,
    archiveEntry: mockArchiveEntry,
    unlock: mockUnlock,
    unlockWebAuthnOptions: mockUnlockWebAuthnOptions,
    unlockWebAuthnVerify: mockUnlockWebAuthnVerify,
    revealEntry: mockRevealEntry,
    getAudit: mockGetAudit,
  },
}));

vi.mock('../lib/useWebAuthnAvailability', () => ({
  useWebAuthnAvailability: () => ({ webAuthnReady: true, webAuthnTimedOut: false }),
}));

vi.mock('../lib/passkeyWebAuthn', () => ({
  getPasskeyAssertion: mockGetPasskeyAssertion,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'admin', trusted_devices_count: 1 },
    hasPermission: mockHasPermission,
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: mockNotifySuccess,
    notifyWarning: mockNotifyWarning,
    notifyApiError: mockNotifyApiError,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

import Passwords, { generateVaultPassword, normalizeTagList } from './Passwords';

const theme = createTheme();

const unlockRequiredError = {
  response: { status: 403, data: { detail: 'Password vault unlock is required' } },
};

const vaultPayload = {
  items: [
    {
      id: 'entry-1',
      group: 'VPN',
      tags: ['prod'],
      login: 'svc-vpn',
      description: 'Production VPN',
      is_archived: false,
      created_at: '2026-05-28T00:00:00+00:00',
      updated_at: '2026-05-28T00:00:00+00:00',
      created_by: 'admin',
      updated_by: 'admin',
      password_configured: true,
    },
  ],
  groups: ['VPN'],
  tags: ['prod', 'staging'],
  unlocked_until: null,
};

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <Passwords />
    </ThemeProvider>,
  );
}

describe('normalizeTagList', () => {
  it('deduplicates tags case-insensitively and strips hash prefix', () => {
    expect(normalizeTagList(['#Prod', 'prod', 'Staging'])).toEqual(['Prod', 'Staging']);
    expect(normalizeTagList('staging, infra')).toEqual(['staging', 'infra']);
  });
});

describe('generateVaultPassword', () => {
  it('uses Web Crypto getRandomValues and respects requested length', () => {
    let value = 0;
    const fakeCrypto = {
      getRandomValues: vi.fn((buffer) => {
        buffer[0] = value % 256;
        value += 31;
        return buffer;
      }),
    };

    const password = generateVaultPassword({ length: 24 }, fakeCrypto);

    expect(password).toHaveLength(24);
    expect(fakeCrypto.getRandomValues).toHaveBeenCalled();
  });
});

describe('Passwords page', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockUseMediaQuery.mockReturnValue(false);
    mockGetEntries.mockReset();
    mockCreateEntry.mockReset();
    mockGetGroups.mockReset();
    mockUpdateEntry.mockReset();
    mockArchiveEntry.mockReset();
    mockUnlock.mockReset();
    mockUnlockWebAuthnOptions.mockReset();
    mockUnlockWebAuthnVerify.mockReset();
    mockGetPasskeyAssertion.mockReset();
    mockRevealEntry.mockReset();
    mockGetAudit.mockReset();
    mockHasPermission.mockClear();
    mockNotifySuccess.mockReset();
    mockNotifyWarning.mockReset();
    mockNotifyApiError.mockReset();
    mockGetEntries.mockResolvedValue(vaultPayload);
    mockGetGroups.mockResolvedValue({ items: [{ id: 'group-1', name: 'VPN', is_active: true, sort_order: 0 }] });
    mockGetAudit.mockResolvedValue({ items: [] });
    mockUnlock.mockResolvedValue({ unlocked_until: new Date(Date.now() + 300_000).toISOString() });
    mockUnlockWebAuthnOptions.mockResolvedValue({
      challenge_id: 'challenge-1',
      public_key: { challenge: 'Y2g=', timeout: 60000 },
    });
    mockUnlockWebAuthnVerify.mockResolvedValue({ unlocked_until: new Date(Date.now() + 300_000).toISOString() });
    mockGetPasskeyAssertion.mockResolvedValue({ id: 'cred', rawId: 'cred', type: 'public-key', response: {} });
    mockRevealEntry.mockResolvedValue({ password: 'plain-secret', unlocked_until: new Date(Date.now() + 300_000).toISOString() });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows unlock banner and searches by login, description and tags', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());
    expect(screen.getByTestId('password-unlock-banner')).toBeInTheDocument();
    expect(screen.getByText(/заблокирован/i)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('password-search-input'), { target: { value: 'production' } });
    await waitFor(() => expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ q: 'production' })));

    fireEvent.change(screen.getByTestId('password-search-input'), { target: { value: 'prod' } });
    await waitFor(() => expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ q: 'prod' })));
  });

  it('searches by login and applies group/tag filters', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('password-search-input'), { target: { value: 'svc' } });

    await waitFor(() => expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ q: 'svc' })));

    fireEvent.click(screen.getByTestId('password-group-VPN'));
    await waitFor(() => expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ group: 'VPN' })));

    fireEvent.click(screen.getByTestId('password-tag-prod'));
    await waitFor(() => expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ tag: 'prod' })));
  });

  it('opens mobile filters drawer on small screens', async () => {
    mockUseMediaQuery.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());
    expect(screen.getByTestId('password-mobile-toolbar')).toBeInTheDocument();
    expect(screen.queryByText('Новая запись')).not.toBeInTheDocument();
    expect(screen.queryByTestId('password-filters-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('password-filters-open'));
    expect(screen.getByTestId('password-filters-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('password-filters-panel')).toBeInTheDocument();
  });

  it('opens create dialog from mobile toolbar icon', async () => {
    mockUseMediaQuery.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('password-mobile-create'));
    expect(screen.getByTestId('password-form-group-select')).toBeInTheDocument();
  });

  it('gates reveal through unlock and hides shown password after timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockRevealEntry.mockRejectedValueOnce(unlockRequiredError);
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Показать пароль svc-vpn'));
    await waitFor(() => expect(screen.getByTestId('password-unlock-dialog')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('password-unlock-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('password-unlock-submit'));

    await waitFor(() => expect(screen.getByText('plain-secret')).toBeInTheDocument());

    expect(mockUnlock).toHaveBeenCalledWith({ totp_code: '123456' });
    expect(mockRevealEntry).toHaveBeenCalledWith('entry-1', { purpose: 'show' });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.queryByText('plain-secret')).not.toBeInTheDocument();
  });

  it('unlocks vault with passkey when trusted device is available', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('password-unlock-open'));
    expect(screen.getByTestId('password-unlock-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('password-unlock-passkey')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('password-unlock-passkey'));

    await waitFor(() => {
      expect(mockUnlockWebAuthnOptions).toHaveBeenCalled();
      expect(mockGetPasskeyAssertion).toHaveBeenCalled();
      expect(mockUnlockWebAuthnVerify).toHaveBeenCalled();
      expect(mockNotifySuccess).toHaveBeenCalledWith(
        'Доступ к раскрытию паролей открыт на 5 минут.',
        expect.objectContaining({ source: 'passwords' }),
      );
    });
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('copies login without unlock dialog', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('password-copy-login-entry-1'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('svc-vpn');
      expect(mockNotifySuccess).toHaveBeenCalledWith(
        'Логин скопирован.',
        expect.objectContaining({ source: 'passwords' }),
      );
    });
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('generates a password and fills the create form', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Новая запись'));
    expect(screen.getByTestId('password-form-group-select')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Сгенерировать'));

    await waitFor(() => {
      expect(screen.getByTestId('generated-password').textContent).not.toBe('—');
    });

    const generated = screen.getByTestId('generated-password').textContent;
    fireEvent.click(screen.getByText('Вставить'));

    expect(screen.getByTestId('password-form-password')).toHaveValue(generated);
  });

  it('offers existing tags in the create form autocomplete', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Новая запись'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Теги' }));

    expect(await screen.findByRole('option', { name: 'staging' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'prod' })).toBeInTheDocument();
  });

  it('reveals password without unlock dialog when server session is already active', async () => {
    const unlockedUntil = new Date(Date.now() + 300_000).toISOString();
    mockGetEntries.mockResolvedValue({ ...vaultPayload, unlocked_until: null });
    mockRevealEntry.mockResolvedValue({
      password: 'plain-secret',
      unlocked_until: unlockedUntil,
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Показать пароль svc-vpn'));

    await waitFor(() => {
      expect(mockRevealEntry).toHaveBeenCalledWith('entry-1', { purpose: 'show' });
      expect(screen.getByText('plain-secret')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('password-unlock-dialog')).not.toBeInTheDocument();
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('copies revealed password with copy purpose after unlock', async () => {
    mockRevealEntry.mockRejectedValueOnce(unlockRequiredError);
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Скопировать пароль svc-vpn'));
    await waitFor(() => expect(screen.getByTestId('password-unlock-dialog')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('password-unlock-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('password-unlock-submit'));

    await waitFor(() => {
      expect(mockRevealEntry).toHaveBeenCalledWith('entry-1', { purpose: 'copy' });
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('plain-secret');
    });
  });

  it('opens mobile bottom sheet with copy actions', async () => {
    mockUseMediaQuery.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('password-entry-row-entry-1'));

    expect(screen.getByTestId('password-entry-mobile-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('password-copy-password-entry-1')).toBeInTheDocument();
    expect(screen.getByTestId('password-copy-login-entry-1')).toBeInTheDocument();
  });
});
