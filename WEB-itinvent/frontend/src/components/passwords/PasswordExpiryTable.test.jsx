import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import PasswordExpiryTable from './PasswordExpiryTable';
import { AD_PASSWORD_PORTAL_URL } from './adPasswordPortal';

const theme = createTheme();

function renderTable(users, isMobile = false) {
  return render(
    <ThemeProvider theme={theme}>
      <PasswordExpiryTable users={users} isMobile={isMobile} />
    </ThemeProvider>,
  );
}

describe('PasswordExpiryTable', () => {
  it('renders password portal link for users who must change password now', () => {
    renderTable([
      {
        login: 'ivanov_ii',
        display_name: 'Иванов Иван',
        must_change_now: true,
        expired: false,
        days_to_expire: 0,
      },
    ]);

    const link = screen.getByTestId('password-expiry-change-link');
    expect(link).toHaveTextContent('Сменить сейчас');
    expect(link).toHaveAttribute('href', AD_PASSWORD_PORTAL_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders password portal link for expired users', () => {
    renderTable([
      {
        login: 'petrov_pp',
        display_name: 'Петров Пётр',
        must_change_now: false,
        expired: true,
        days_to_expire: 0,
      },
    ]);

    const link = screen.getByTestId('password-expiry-change-link');
    expect(link).toHaveTextContent('Просрочен');
    expect(link).toHaveAttribute('href', AD_PASSWORD_PORTAL_URL);
  });

  it('renders never-expires status without portal link', () => {
    renderTable([
      {
        login: 'service_acc',
        display_name: 'Сервисный аккаунт',
        must_change_now: false,
        expired: false,
        password_never_expires: true,
        expiration_date: null,
        days_to_expire: null,
      },
    ]);

    expect(screen.getByTestId('password-expiry-never-expires')).toHaveTextContent('Бессрочный');
    expect(screen.queryByTestId('password-expiry-change-link')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});
