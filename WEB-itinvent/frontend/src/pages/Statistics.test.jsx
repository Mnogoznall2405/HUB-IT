import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { jsonAPI } = vi.hoisted(() => ({
  jsonAPI: {
    getPcCleaningStatistics: vi.fn(),
    getMfuStatistics: vi.fn(),
    getBatteryStatistics: vi.fn(),
    getPcComponentsStatistics: vi.fn(),
  },
}));

vi.mock('../api/json_client', () => ({ jsonAPI }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => false }) }));
vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({ notifyApiError: vi.fn(), notifySuccess: vi.fn() }),
}));
vi.mock('../components/layout/MainLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../components/layout/MobileShellPageHeader', () => ({ default: () => null }));
vi.mock('../components/layout/PageShell', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../components/layout/PageTopBar', () => ({ default: ({ tabs }) => <div>{tabs}</div> }));
vi.mock('./statistics/PcRemainingDialog', () => ({ default: () => null }));

import Statistics from './Statistics';

const renderPage = () => render(
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>
      <Statistics />
    </ThemeProvider>
  </MemoryRouter>,
);

describe('Statistics request ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show an error of the previous tab after switching tabs', async () => {
    let rejectPc;
    jsonAPI.getPcCleaningStatistics.mockImplementation(() => new Promise((_, reject) => { rejectPc = reject; }));
    jsonAPI.getBatteryStatistics.mockResolvedValue({ data: {} });
    renderPage();
    await waitFor(() => expect(jsonAPI.getPcCleaningStatistics).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Батареи' }));
    await waitFor(() => expect(jsonAPI.getBatteryStatistics).toHaveBeenCalledTimes(1));
    await act(async () => { rejectPc(new Error('late pc failure')); });

    expect(screen.queryByText(/Не удалось загрузить статистику чистки ПК/)).not.toBeInTheDocument();
  });
});
