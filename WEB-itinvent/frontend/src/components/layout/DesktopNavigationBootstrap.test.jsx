import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopNavigationBootstrap from './DesktopNavigationBootstrap';

const { subscribeMock, unsubscribeMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock('../../lib/desktopBridge', () => ({
  subscribeDesktopNavigation: subscribeMock,
}));

const LocationProbe = () => {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
};

describe('DesktopNavigationBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribeMock.mockReturnValue(unsubscribeMock);
  });

  it('opens a desktop route through React Router without reloading the document', () => {
    let navigationHandler;
    subscribeMock.mockImplementation((handler) => {
      navigationHandler = handler;
      return unsubscribeMock;
    });

    const { unmount } = render(
      <MemoryRouter
        initialEntries={['/dashboard']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <DesktopNavigationBootstrap />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByText('/dashboard')).toBeInTheDocument();

    act(() => {
      navigationHandler('/chat?conversation=7&message=42');
    });

    expect(screen.getByText('/chat?conversation=7&message=42')).toBeInTheDocument();
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledOnce();
  });
});
