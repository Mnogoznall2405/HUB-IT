import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DesktopProtocolHandoff from './DesktopProtocolHandoff';

const handoffMocks = vi.hoisted(() => ({
  canOffer: true,
  href: 'hubit://open/tasks?task=7',
  route: '/tasks?task=7',
  launch: vi.fn(),
  skip: vi.fn(),
  setPreference: vi.fn(),
}));

vi.mock('../../lib/desktopProtocolHandoff', () => ({
  canOfferDesktopHandoff: () => handoffMocks.canOffer,
  resolveHandoffRoute: () => handoffMocks.route,
  buildHubitProtocolHref: () => handoffMocks.href,
  launchHubitProtocol: handoffMocks.launch,
  skipDesktopHandoffThisSession: handoffMocks.skip,
  setDesktopHandoffPreference: handoffMocks.setPreference,
}));

function renderHandoff(path = '/tasks?task=7') {
  return render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<DesktopProtocolHandoff />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('DesktopProtocolHandoff', () => {
  beforeEach(() => {
    handoffMocks.canOffer = true;
    handoffMocks.href = 'hubit://open/tasks?task=7';
    handoffMocks.route = '/tasks?task=7';
    handoffMocks.launch.mockReset();
    handoffMocks.skip.mockReset();
    handoffMocks.setPreference.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('auto-launches the desktop protocol once and can stay in the browser', () => {
    renderHandoff();

    expect(screen.getByTestId('desktop-protocol-handoff')).toBeInTheDocument();
    expect(handoffMocks.launch).toHaveBeenCalledTimes(1);
    expect(handoffMocks.launch).toHaveBeenCalledWith('hubit://open/tasks?task=7');

    fireEvent.click(screen.getByRole('button', { name: 'Остаться в браузере' }));
    expect(handoffMocks.skip).toHaveBeenCalledTimes(1);
    expect(handoffMocks.setPreference).not.toHaveBeenCalled();
    expect(screen.queryByTestId('desktop-protocol-handoff')).not.toBeInTheDocument();
  });

  it('does not render when handoff is not offered', () => {
    handoffMocks.canOffer = false;
    renderHandoff();
    expect(screen.queryByTestId('desktop-protocol-handoff')).not.toBeInTheDocument();
    expect(handoffMocks.launch).not.toHaveBeenCalled();
  });
});
