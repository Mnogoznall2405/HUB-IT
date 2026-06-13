import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import MailQuotaReport from './MailQuotaReport';
import { mailMailboxQuotasAPI } from '../../api/mailMailboxQuotas';

vi.mock('../../api/mailMailboxQuotas', () => ({
  mailMailboxQuotasAPI: {
    getLatestSnapshot: vi.fn(),
    getSnapshotSummary: vi.fn(),
    listRows: vi.fn(),
  },
}));

const snapshot = {
  id: 7,
  imported_at: '2026-06-10T07:00:00Z',
  collected_at: '2026-06-10T06:00:00Z',
  source_host: 'COLLECTOR-01',
  exchange_server: 'exch01.corp.local',
  row_count: 4,
};

const summary = {
  total: 4,
  with_quota: 3,
  no_quota: 1,
  over_quota: 1,
  warning_90: 1,
  by_database: [
    { name: 'DB01', total: 2, over_quota: 1, warning_90: 0 },
    { name: 'DB02', total: 2, over_quota: 0, warning_90: 1 },
  ],
};

const rows = {
  total: 4,
  items: [
    {
      id: 1,
      display_name: 'Normal User',
      email: 'normal@example.test',
      used_bytes: 1073741824,
      quota_bytes: 10737418240,
      free_bytes: 9663676416,
      used_percent: 10,
      database_name: 'DB01',
    },
    {
      id: 2,
      display_name: 'Warning User',
      email: 'warn@example.test',
      used_bytes: 9663676416,
      quota_bytes: 10737418240,
      free_bytes: 1073741824,
      used_percent: 95,
      database_name: 'DB02',
    },
    {
      id: 3,
      display_name: 'Over User',
      email: 'over@example.test',
      used_bytes: 11811160064,
      quota_bytes: 10737418240,
      free_bytes: 0,
      used_percent: 110,
      database_name: 'DB01',
    },
    {
      id: 4,
      display_name: 'Default Quota User',
      email: 'default@example.test',
      used_bytes: 2147483648,
      quota_bytes: 5368709120,
      free_bytes: 3221225472,
      used_percent: 40,
      uses_default_quota: true,
      database_name: 'DB02',
    },
  ],
  snapshot,
};

function renderReport(props = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <MailQuotaReport {...props} />
    </ThemeProvider>,
  );
}

describe('MailQuotaReport', () => {
  beforeEach(() => {
    vi.mocked(mailMailboxQuotasAPI.getLatestSnapshot).mockResolvedValue(snapshot);
    vi.mocked(mailMailboxQuotasAPI.getSnapshotSummary).mockResolvedValue(summary);
    vi.mocked(mailMailboxQuotasAPI.listRows).mockResolvedValue(rows);
  });

  it('renders compact metrics from summary and table rows', async () => {
    renderReport();

    await waitFor(() => {
      expect(screen.getByText('normal@example.test')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mail-quota-report')).toBeInTheDocument();
    expect(screen.getByTestId('quota-metric-total')).toHaveTextContent('4');
    expect(screen.getByTestId('quota-metric-over')).toHaveTextContent('Переполнено');
    expect(screen.getByTestId('quota-metric-warning')).toHaveTextContent('≥ 90%');
    expect(screen.getByTestId('quota-metric-default')).toHaveTextContent('Лимит не задан');
    expect(screen.getByLabelText('Фильтр базы Exchange')).toBeInTheDocument();
    expect(screen.getByText(/Показано 4 из 4/)).toBeInTheDocument();
  });

  it('renders quota status chips for each row type', async () => {
    renderReport();

    await waitFor(() => {
      expect(screen.getByText('over@example.test')).toBeInTheDocument();
    });

    expect(screen.getAllByTestId('quota-status-ok')).toHaveLength(2);
    expect(screen.getByTestId('quota-status-warning')).toBeInTheDocument();
    expect(screen.getByTestId('quota-status-critical')).toBeInTheDocument();
    expect(screen.getByText(/5\.00 GB по умолч\./)).toBeInTheDocument();
  });

  it('applies warning filter when compact metric is clicked', async () => {
    renderReport();

    await waitFor(() => {
      expect(screen.getByText('warn@example.test')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('quota-metric-warning'));

    await waitFor(() => {
      expect(mailMailboxQuotasAPI.listRows).toHaveBeenCalledWith(7, expect.objectContaining({
        warning_90: true,
      }));
    });
  });

  it('renders mobile rows instead of the desktop quota table', async () => {
    renderReport({ isMobile: true });

    await waitFor(() => {
      expect(screen.getByText('over@example.test')).toBeInTheDocument();
    });

    expect(screen.getByTestId('quota-mobile-list')).toBeInTheDocument();
    expect(screen.getAllByTestId('quota-mobile-row')).toHaveLength(4);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByText('Лимит').length).toBeGreaterThan(0);
  });
});
