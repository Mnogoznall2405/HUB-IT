import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetOrganizationalUnits,
  mockGetPasswordExpiry,
  mockNotifyApiError,
  mockUseMediaQuery,
} = vi.hoisted(() => ({
  mockGetOrganizationalUnits: vi.fn(),
  mockGetPasswordExpiry: vi.fn(),
  mockNotifyApiError: vi.fn(),
  mockUseMediaQuery: vi.fn(() => false),
}));

vi.mock('@mui/material/useMediaQuery', () => ({
  default: mockUseMediaQuery,
}));

vi.mock('../../api/adUsers', () => ({
  adUsersAPI: {
    getOrganizationalUnits: mockGetOrganizationalUnits,
    getPasswordExpiry: mockGetPasswordExpiry,
  },
}));

vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifyApiError: mockNotifyApiError,
  }),
}));

import PasswordAdExpiryView from './PasswordAdExpiryView';

const theme = createTheme();

const USERS_STANDART_DN = 'OU=Users standart,DC=example,DC=local';

const reportPayload = {
  status: 'ok',
  policy_days: 40,
  total: 1,
  cached_at: '2026-06-17T10:15:00Z',
  from_cache: true,
  users: [
    {
      login: 'ivanov_ii',
      display_name: 'Иванов Иван',
      department: 'IT',
      branch_name: 'Центральный',
      pwd_last_set_date: '2026-05-01T00:00:00+00:00',
      expiration_date: '2026-06-10T00:00:00+00:00',
      days_to_expire: 3,
      expired: false,
      must_change_now: false,
    },
  ],
};

function mockOuApi() {
  mockGetOrganizationalUnits.mockImplementation(async (parentDn = '') => {
    if (!parentDn) {
      return {
        status: 'ok',
        items: [
          {
            dn: USERS_STANDART_DN,
            label: 'Users standart',
            has_children: true,
          },
        ],
      };
    }
    if (parentDn === USERS_STANDART_DN) {
      return {
        status: 'ok',
        items: [
          {
            dn: 'OU=Users Objects,OU=Users standart,DC=example,DC=local',
            label: 'Users Objects',
            has_children: false,
          },
        ],
      };
    }
    return { status: 'ok', items: [] };
  });
}

function renderView() {
  return render(
    <ThemeProvider theme={theme}>
      <PasswordAdExpiryView />
    </ThemeProvider>,
  );
}

describe('PasswordAdExpiryView', () => {
  beforeEach(() => {
    mockUseMediaQuery.mockReturnValue(false);
    mockGetOrganizationalUnits.mockReset();
    mockGetPasswordExpiry.mockReset();
    mockNotifyApiError.mockReset();
    mockOuApi();
    mockGetPasswordExpiry.mockResolvedValue(reportPayload);
  });

  it('loads Users standart by default and renders desktop table', async () => {
    renderView();

    await waitFor(() => expect(screen.getByTestId('password-expiry-table')).toBeInTheDocument());
    expect(screen.getByText('Иванов Иван')).toBeInTheDocument();
    expect(mockGetPasswordExpiry).toHaveBeenCalledWith(expect.objectContaining({
      ouDn: USERS_STANDART_DN,
    }));
    expect(screen.getByTestId('password-expiry-selected-ou')).toHaveTextContent('Users standart');
  });

  it('shows spinner while OU tree and report are loading', async () => {
    renderView();
    expect(screen.getByTestId('password-expiry-spinner')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('password-expiry-spinner')).not.toBeInTheDocument());
  });

  it('allows selecting nested OU from Users standart tree', async () => {
    renderView();

    await waitFor(() => expect(screen.getByTestId('password-expiry-ou-tree')).toBeInTheDocument());
    const nestedNode = await screen.findByText('Users Objects');
    fireEvent.click(nestedNode);

    await waitFor(() => expect(mockGetPasswordExpiry).toHaveBeenCalledWith(expect.objectContaining({
      ouDn: 'OU=Users Objects,OU=Users standart,DC=example,DC=local',
    })));
  });

  it('opens OU drawer on mobile and renders cards', async () => {
    mockUseMediaQuery.mockReturnValue(true);
    renderView();

    await waitFor(() => expect(screen.getByTestId('password-expiry-cards')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('password-expiry-open-ou-drawer'));

    const drawer = screen.getByTestId('password-expiry-ou-drawer');
    expect(within(drawer).getByTestId('password-expiry-ou-tree')).toBeInTheDocument();
  });

  it('reloads report when search query changes', async () => {
    renderView();

    await waitFor(() => expect(mockGetPasswordExpiry).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('password-expiry-search-input'), { target: { value: 'иванов' } });

    await waitFor(() => expect(mockGetPasswordExpiry).toHaveBeenCalledWith(expect.objectContaining({ q: 'иванов' })));
  });

  it('shows cached snapshot timestamp', async () => {
    renderView();

    await waitFor(() => expect(screen.getByTestId('password-expiry-cached-at')).toBeInTheDocument());
    expect(screen.getByTestId('password-expiry-cached-at')).toHaveTextContent('кеш');
  });

  it('forces AD refresh from desktop refresh button', async () => {
    renderView();

    await waitFor(() => expect(screen.getByTestId('password-expiry-refresh')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('password-expiry-refresh'));

    await waitFor(() => expect(mockGetPasswordExpiry).toHaveBeenCalledWith(expect.objectContaining({ force: true })));
  });
});
