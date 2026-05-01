import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  adUsersAPI: {
    getImportCandidates: vi.fn(),
    syncToApp: vi.fn(),
  },
  hasPermission: vi.fn(),
}));

vi.mock('../api/client', () => ({
  adUsersAPI: hoisted.adUsersAPI,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: hoisted.hasPermission,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

import AdUsers from './AdUsers';

const theme = createTheme();

const candidates = [
  {
    login: 'new.user',
    display_name: 'New User',
    department: 'IT',
    title: 'Engineer',
    mail: 'new.user@example.com',
    mailbox_login: 'new.user@zsgp.corp',
    import_status: 'new',
    warnings: [],
  },
  {
    login: 'ldap.user',
    display_name: 'LDAP User',
    department: '',
    title: 'Specialist',
    mail: '',
    mailbox_login: 'ldap.user@zsgp.corp',
    import_status: 'exists_ldap',
    warnings: ['missing_mail', 'missing_department'],
  },
  {
    login: 'local.user',
    display_name: 'Local User',
    department: 'HR',
    title: 'Manager',
    mail: 'local.user@example.com',
    mailbox_login: 'local.user@zsgp.corp',
    import_status: 'local_conflict',
    warnings: [],
  },
];

function installMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <AdUsers />
    </ThemeProvider>,
  );
}

describe('AdUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMatchMedia();
    window.open = vi.fn();
    hoisted.hasPermission.mockImplementation((permission) => permission === 'ad_users.manage');
    hoisted.adUsersAPI.getImportCandidates.mockResolvedValue(candidates);
    hoisted.adUsersAPI.syncToApp.mockResolvedValue({
      created: 1,
      updated: 0,
      skipped_conflicts: 0,
      missing_mail: 0,
      missing_department: 0,
      not_found: 0,
      total_requested: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects new AD users and bulk imports only selected logins', async () => {
    renderPage();

    expect(await screen.findByText('Всего: 3')).toBeInTheDocument();
    expect(screen.getByText('Новых: 1')).toBeInTheDocument();
    expect(screen.getByText('Конфликтов: 1')).toBeInTheDocument();
    expect(screen.getByText('Без почты: 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать новых' }));
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать выбранных (1)' }));

    await waitFor(() => {
      expect(hoisted.adUsersAPI.syncToApp).toHaveBeenCalledWith(['new.user']);
    });
  });

  it('shows import statuses and runs a single-row import', async () => {
    renderPage();

    fireEvent.click(await screen.findByText('IT'));

    expect(screen.getByText('New User')).toBeInTheDocument();
    expect(screen.getByText('Новый')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Добавить в web' }));

    await waitFor(() => {
      expect(hoisted.adUsersAPI.syncToApp).toHaveBeenCalledWith(['new.user']);
    });
  });

  it('filters AD users by display name and expands matching departments', async () => {
    renderPage();

    const input = await screen.findByLabelText('Поиск по фамилии');
    vi.useFakeTimers();

    fireEvent.change(input, {
      target: { value: 'New' },
    });

    expect(screen.queryByText('New User')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByText('New User')).toBeInTheDocument();
    expect(screen.queryByText('LDAP User')).not.toBeInTheDocument();
    expect(screen.queryByText('Local User')).not.toBeInTheDocument();
  });

  it('selects all importable users in a department from the department checkbox', async () => {
    renderPage();

    fireEvent.click(await screen.findByLabelText('Выбрать отдел IT'));
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать выбранных (1)' }));

    await waitFor(() => {
      expect(hoisted.adUsersAPI.syncToApp).toHaveBeenCalledWith(['new.user']);
    });
  });
});
