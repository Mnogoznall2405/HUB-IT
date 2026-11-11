import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { MainLayoutShellContext } from './MainLayoutShellContext';
import PageTopBar from './PageTopBar';

const baseShell = {
  headerMode: 'hidden',
  drawerOpen: false,
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  toggleDrawer: vi.fn(),
  openNotifications: vi.fn(),
  notificationsBadgeValue: 3,
  showNotificationsButton: true,
  showDatabaseSelector: true,
  databases: [{ id: 'main', name: 'Основная' }, { id: 'archive', name: 'Архив' }],
  currentDb: { id: 'main', name: 'Основная' },
  currentDbName: 'Основная',
  dbLoading: false,
  dbLocked: false,
  onDatabaseChange: vi.fn(),
};

const renderBar = (shell = {}, props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <MainLayoutShellContext.Provider value={{ ...baseShell, ...shell }}>
      <PageTopBar title="Компьютеры" {...props}>
        <input aria-label="Поиск" />
      </PageTopBar>
    </MainLayoutShellContext.Provider>
  </ThemeProvider>,
);

describe('PageTopBar', () => {
  it('puts the portal controls into the page row: menu, title, page controls, base, bell', () => {
    const openDrawer = vi.fn();
    const openNotifications = vi.fn();
    renderBar({ openDrawer, openNotifications });

    const bar = screen.getByTestId('page-top-bar');
    expect(within(bar).getByRole('heading', { level: 1, name: 'Компьютеры' })).toBeInTheDocument();
    expect(within(bar).getByLabelText('Поиск')).toBeInTheDocument();
    expect(within(bar).getByRole('combobox', { name: 'База данных' })).toHaveTextContent('Основная');

    fireEvent.click(within(bar).getByRole('button', { name: 'Открыть главное меню' }));
    expect(openDrawer).toHaveBeenCalledTimes(1);
    fireEvent.click(within(bar).getByRole('button', { name: 'Открыть уведомления' }));
    expect(openNotifications).toHaveBeenCalledTimes(1);
  });

  it('shows no base select when the page does not use bases', () => {
    renderBar({ showDatabaseSelector: false });
    expect(screen.queryByRole('combobox', { name: 'База данных' })).not.toBeInTheDocument();
  });
});
