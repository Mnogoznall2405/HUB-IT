import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MobileMenu from './MobileMenu';

const {
  mockNavigate,
  mockHasPermission,
  mockLocation,
  mockLogout,
  mockUser,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockHasPermission: vi.fn(() => true),
  mockLocation: { pathname: '/menu', search: '' },
  mockLogout: vi.fn(async () => {}),
  mockUser: {
    id: 1,
    username: 'admin',
    role: 'admin',
    full_name: 'Админ Тестов',
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    hasPermission: mockHasPermission,
    logout: mockLogout,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock('../lib/routeLoaders', () => ({
  prefetchRouteByPath: vi.fn(async () => {}),
}));

function renderMobileMenu(initialEntry = '/menu') {
  return render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/menu" element={<MobileMenu />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('MobileMenu page', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockClear();
    mockHasPermission.mockReset();
    mockHasPermission.mockImplementation(() => true);
    Object.assign(mockUser, {
      id: 1,
      username: 'admin',
      role: 'admin',
      full_name: 'Админ Тестов',
    });
    mockLocation.pathname = '/menu';
    mockLocation.search = '';
  });

  it('renders one app grid, profile identity, and account actions without duplicate groups', () => {
    renderMobileMenu();

    expect(screen.getByTestId('mobile-menu-profile-card')).toHaveTextContent('Админ Тестов');
    expect(screen.getByTestId('mobile-menu-app-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-menu-quick-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-menu-group-main')).not.toBeInTheDocument();
    expect(screen.queryByText('Открыто')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-menu-action-profile')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-menu-action-settings')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-menu-action-admin')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-menu-action-logout')).toBeInTheDocument();
  });

  it('opens profile, settings, and administration as separate account zones', () => {
    renderMobileMenu();

    fireEvent.click(screen.getByTestId('mobile-menu-profile-card'));
    fireEvent.click(screen.getByTestId('mobile-menu-action-settings'));
    fireEvent.click(screen.getByTestId('mobile-menu-action-admin'));

    expect(mockNavigate).toHaveBeenNthCalledWith(1, '/profile');
    expect(mockNavigate).toHaveBeenNthCalledWith(2, '/settings');
    expect(mockNavigate).toHaveBeenNthCalledWith(3, '/admin');
  });

  it('hides administration for a regular user without administrative permissions', () => {
    Object.assign(mockUser, { role: 'operator', username: 'operator' });
    mockHasPermission.mockImplementation(() => false);

    renderMobileMenu();

    expect(screen.getByTestId('mobile-menu-app-grid')).toBeEmptyDOMElement();
    expect(screen.queryByTestId('mobile-menu-action-admin')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-menu-action-profile')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-menu-action-settings')).toBeInTheDocument();
  });

  it('navigates from the single app grid without duplicate module buttons', () => {
    renderMobileMenu();

    const grid = screen.getByTestId('mobile-menu-app-grid');
    expect(within(grid).getAllByTestId('mobile-menu-item-dashboard')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('mobile-menu-item-dashboard'));
    fireEvent.click(screen.getByTestId('mobile-menu-item-tasks'));

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    expect(mockNavigate).toHaveBeenCalledWith('/tasks');
  });

  it('logs out and redirects to login', async () => {
    renderMobileMenu();

    fireEvent.click(screen.getByTestId('mobile-menu-action-logout'));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });
});
