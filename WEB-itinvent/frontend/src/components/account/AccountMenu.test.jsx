import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import AccountMenu from './AccountMenu';

function renderMenu({ showAdministration = true } = {}) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const onLogout = vi.fn();

  render(
    <ThemeProvider theme={createTheme()}>
      <AccountMenu
        anchorEl={anchor}
        onClose={onClose}
        onNavigate={onNavigate}
        onLogout={onLogout}
        showAdministration={showAdministration}
        reducedMotion
      />
    </ThemeProvider>,
  );

  return { onClose, onNavigate, onLogout };
}

describe('AccountMenu', () => {
  it('opens independent profile, settings, and admin routes', () => {
    const { onClose, onNavigate } = renderMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Профиль' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/profile');
  });

  it('hides administration without permission and keeps logout', () => {
    const { onLogout } = renderMenu({ showAdministration: false });

    expect(screen.queryByRole('menuitem', { name: 'Администрирование' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Выход' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
