import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { innerProps } = vi.hoisted(() => ({
  innerProps: { current: null },
}));

// Stub only the heavy inner layout; the real route shell, the real router and
// the real matching logic stay under test — this is the coverage that was
// missing when `useMatches` crashed under the app's non-data `<Routes>`.
vi.mock('./MainLayout', () => ({
  MainLayoutInner: (props) => {
    innerProps.current = props;
    return (
      <div data-testid="shell-inner" data-bare={props.bare ? 'true' : 'false'}>
        {props.children}
      </div>
    );
  },
}));

import MainLayoutRouteShell from './MainLayoutRouteShell';

function renderShellAt(initialPath) {
  innerProps.current = null;
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<MainLayoutRouteShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MainLayoutRouteShell under the app router type', () => {
  it('renders under <Routes> (non-data router) without throwing', () => {
    renderShellAt('/tasks');
    expect(screen.getByTestId('shell-inner')).toBeInTheDocument();
    expect(screen.getByTestId('shell-inner')).toHaveAttribute('data-bare', 'false');
  });

  it.each(['/chat', '/scan-center', '/voice', '/profile', '/settings', '/settings/general', '/admin', '/admin/users'])(
    'marks %s as a hubBare route (headless shell)',
    (path) => {
      renderShellAt(path);
      expect(screen.getByTestId('shell-inner')).toHaveAttribute('data-bare', 'true');
      expect(innerProps.current?.headerMode).toBe('hidden');
    },
  );

  it.each(['/tasks', '/database', '/feed', '/chat-settings'])(
    'keeps %s on the full chrome shell',
    (path) => {
      renderShellAt(path);
      expect(screen.getByTestId('shell-inner')).toHaveAttribute('data-bare', 'false');
    },
  );
});
