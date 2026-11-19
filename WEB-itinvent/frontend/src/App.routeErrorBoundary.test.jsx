import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockForceAppHardReload } = vi.hoisted(() => ({
  mockForceAppHardReload: vi.fn(),
}));

vi.mock('./lib/routeChunkRecovery', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, forceAppHardReload: mockForceAppHardReload };
});

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: null,
    loading: false,
    hasPermission: () => true,
    isAuthenticated: () => false,
  }),
}));

vi.mock('./components/chat/ChatSocketBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopNavigationBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopPresenceBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopLifecycleBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopMemoryPressureBootstrap', () => ({ default: () => null }));
vi.mock('./lib/appBadge', () => ({ syncAppBadge: vi.fn(() => Promise.resolve()) }));

import { RouteErrorBoundary } from './App';

describe('RouteErrorBoundary', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    mockForceAppHardReload.mockReset();
    mockForceAppHardReload.mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('recovers from a non-chunk render error via Повторить without a hard reload', async () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('render exploded');
      return <div>content ok</div>;
    }
    render(
      <RouteErrorBoundary pathname="/tasks">
        <Flaky />
      </RouteErrorBoundary>,
    );

    expect(screen.getByText('Раздел не удалось отобразить. Попробуйте ещё раз или откройте другой раздел.')).toBeInTheDocument();
    shouldThrow = false;

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('content ok')).toBeInTheDocument();
    expect(mockForceAppHardReload).not.toHaveBeenCalled();
  });

  it('resets the fallback on a pathname change but not on a same-pathname rerender', () => {
    function AlwaysThrows() {
      throw new Error('permanent failure');
    }
    const { rerender } = render(
      <RouteErrorBoundary pathname="/a">
        <AlwaysThrows />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();

    rerender(
      <RouteErrorBoundary pathname="/a">
        <div>healthy child</div>
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText('healthy child')).toBeNull();

    rerender(
      <RouteErrorBoundary pathname="/b">
        <div>healthy child</div>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('healthy child')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('keeps the Обновить hard-reload path for chunk load errors', async () => {
    function ChunkBroke() {
      throw new Error('Failed to fetch dynamically imported module');
    }
    render(
      <RouteErrorBoundary pathname="/mail">
        <ChunkBroke />
      </RouteErrorBoundary>,
    );

    expect(screen.getByText('Нужно обновить экран')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));

    await waitFor(() => expect(mockForceAppHardReload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Обновляем...' })).toBeDisabled();
  });
});
