import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  current: {
    authChecking: false,
    loading: false,
    isAuthenticated: () => false,
  },
}));

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => authState.current,
}));

vi.mock('./components/layout/BrandedRouteLoader', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement('div', { role: 'status' }, 'route-loader'),
  };
});

import { ProtectedRoute } from './App';

function renderProtectedRoute(initialPath = '/private') {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/private" element={<div>private page</div>} />
        </Route>
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute startup auth guard', () => {
  beforeEach(() => {
    authState.current = {
      authChecking: false,
      loading: false,
      isAuthenticated: () => false,
    };
  });

  it('renders private content while a cached session is being validated in the background', () => {
    authState.current = {
      authChecking: true,
      loading: false,
      isAuthenticated: () => true,
    };

    renderProtectedRoute();

    expect(screen.getByText('private page')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a route loader for cold startup when there is no cached user yet', () => {
    authState.current = {
      authChecking: false,
      loading: true,
      isAuthenticated: () => false,
    };

    renderProtectedRoute();

    expect(screen.getByRole('status')).toHaveTextContent('route-loader');
    expect(screen.queryByText('private page')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to login after startup finishes', () => {
    authState.current = {
      authChecking: false,
      loading: false,
      isAuthenticated: () => false,
    };

    renderProtectedRoute();

    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('private page')).not.toBeInTheDocument();
  });
});
