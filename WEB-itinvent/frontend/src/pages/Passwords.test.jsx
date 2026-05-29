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
  mockRevealEntry,
  mockGetAudit,
  mockHasPermission,
  mockNotifySuccess,
  mockNotifyWarning,
  mockNotifyApiError,
} = vi.hoisted(() => ({
  mockGetEntries: vi.fn(),
  mockGetGroups: vi.fn(),
  mockCreateEntry: vi.fn(),
  mockUpdateEntry: vi.fn(),
  mockArchiveEntry: vi.fn(),
  mockUnlock: vi.fn(),
  mockRevealEntry: vi.fn(),
  mockGetAudit: vi.fn(),
  mockHasPermission: vi.fn((permission) => ['passwords.read', 'passwords.write'].includes(permission)),
  mockNotifySuccess: vi.fn(),
  mockNotifyWarning: vi.fn(),
  mockNotifyApiError: vi.fn(),
}));

vi.mock('../api/passwords', () => ({
  passwordsAPI: {
    getEntries: mockGetEntries,
    getGroups: mockGetGroups,
    createEntry: mockCreateEntry,
    updateEntry: mockUpdateEntry,
    archiveEntry: mockArchiveEntry,
    unlock: mockUnlock,
    revealEntry: mockRevealEntry,
    getAudit: mockGetAudit,
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'admin' },
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
    mockGetEntries.mockReset();
    mockCreateEntry.mockReset();
    mockGetGroups.mockReset();
    mockUpdateEntry.mockReset();
    mockArchiveEntry.mockReset();
    mockUnlock.mockReset();
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
    mockRevealEntry.mockResolvedValue({ password: 'plain-secret', unlocked_until: new Date(Date.now() + 300_000).toISOString() });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('gates reveal through unlock and hides shown password after timeout', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());
    vi.useFakeTimers();

    fireEvent.click(screen.getByLabelText('Показать пароль svc-vpn'));
    expect(screen.getAllByText('Разблокировка 2FA').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByTestId('password-unlock-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Разблокировать'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockUnlock).toHaveBeenCalledWith({ totp_code: '123456' });
    expect(mockRevealEntry).toHaveBeenCalledWith('entry-1', { purpose: 'show' });
    expect(screen.getByText('plain-secret')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.queryByText('plain-secret')).not.toBeInTheDocument();
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

  it('copies revealed password with copy purpose after unlock', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('svc-vpn')).toBeInTheDocument());
    vi.useFakeTimers();

    fireEvent.click(screen.getByLabelText('Скопировать пароль svc-vpn'));
    fireEvent.change(screen.getByTestId('password-unlock-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Разблокировать'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRevealEntry).toHaveBeenCalledWith('entry-1', { purpose: 'copy' });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('plain-secret');
  });
});
