import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanCenter from './ScanCenter';
import { scanAPI } from '../api/client';

vi.mock('../api/client', () => ({
  scanAPI: {
    getDashboard: vi.fn(),
    getBranches: vi.fn(),
    getAgentsTable: vi.fn(),
    getAgentsActivity: vi.fn(),
    getHostsTable: vi.fn(),
    getIncidents: vi.fn(),
    getTasks: vi.fn(),
    createTask: vi.fn(),
    ackIncident: vi.fn(),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: () => true,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

const dashboardPayload = {
  totals: {
    agents_total: 1,
    agents_online: 1,
    incidents_new: 1,
    queue_active: 0,
    queue_expired: 0,
  },
  new_hosts: ['HOST-01'],
};

const agentRow = {
  agent_id: 'agent-1',
  hostname: 'HOST-01',
  branch: 'Тюмень',
  ip_address: '10.10.1.1',
  is_online: true,
  age_seconds: 30,
  last_seen_at: 1710000000,
  queue_size: 0,
  active_task: null,
  last_task: null,
};

const hostRow = {
  hostname: 'HOST-01',
  branch: 'Тюмень',
  user: 'Петров П.П.',
  ip_address: '10.10.1.1',
  incidents_new: 1,
  incidents_total: 1,
  top_severity: 'high',
  last_incident_at: 1710000100,
  top_exts: ['pdf'],
  top_source_kinds: ['pdf'],
};

const incidentRow = {
  id: 'incident-1',
  hostname: 'HOST-01',
  branch: 'Тюмень',
  severity: 'high',
  status: 'new',
  created_at: 1710000100,
  file_path: 'C:\\Docs\\secret.pdf',
  file_name: 'secret.pdf',
  source_kind: 'pdf',
  user_full_name: 'Петров П.П.',
  matched_patterns: [{ pattern_name: 'password', value: 'secret' }],
};

describe('ScanCenter page', () => {
  beforeEach(() => {
    scanAPI.getDashboard.mockReset();
    scanAPI.getBranches.mockReset();
    scanAPI.getAgentsTable.mockReset();
    scanAPI.getAgentsActivity.mockReset();
    scanAPI.getHostsTable.mockReset();
    scanAPI.getIncidents.mockReset();
    scanAPI.getTasks.mockReset();
    scanAPI.createTask.mockReset();
    scanAPI.ackIncident.mockReset();

    scanAPI.getDashboard.mockResolvedValue(dashboardPayload);
    scanAPI.getBranches.mockResolvedValue(['Тюмень', 'Москва']);
    scanAPI.getAgentsTable.mockResolvedValue({ total: 1, items: [agentRow] });
    scanAPI.getAgentsActivity.mockResolvedValue({ items: [] });
    scanAPI.getHostsTable.mockResolvedValue({ total: 1, items: [hostRow] });
    scanAPI.getIncidents.mockResolvedValue({ total: 1, items: [incidentRow] });
    scanAPI.getTasks.mockResolvedValue({
      total: 0,
      items: [],
    });
    scanAPI.createTask.mockResolvedValue({
      success: true,
      task: {
        id: 'task-1',
        agent_id: 'agent-1',
        command: 'scan_now',
        status: 'queued',
        created_at: 1710000200,
        ttl_at: 1710000500,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates scan task without full page reload and switches to task polling', async () => {
    scanAPI.getAgentsActivity
      .mockResolvedValueOnce({
        items: [
          {
            agent_id: 'agent-1',
            is_online: true,
            last_seen_at: 1710000210,
            queue_size: 1,
            active_task: {
              id: 'task-1',
              agent_id: 'agent-1',
              command: 'scan_now',
              status: 'acknowledged',
              created_at: 1710000200,
              updated_at: 1710000210,
              ttl_at: 1710000500,
              result: {
                phase: 'server_processing',
                scanned: 4,
                queued: 2,
                skipped: 2,
                deferred: 0,
                jobs_total: 2,
                jobs_pending: 1,
                jobs_done_clean: 1,
                jobs_done_with_incident: 0,
                jobs_failed: 0,
              },
            },
            last_task: {
              id: 'task-1',
              agent_id: 'agent-1',
              command: 'scan_now',
              status: 'acknowledged',
              created_at: 1710000200,
              updated_at: 1710000210,
              ttl_at: 1710000500,
              result: {
                phase: 'server_processing',
                scanned: 4,
                queued: 2,
                skipped: 2,
                deferred: 0,
                jobs_total: 2,
                jobs_pending: 1,
                jobs_done_clean: 1,
                jobs_done_with_incident: 0,
                jobs_failed: 0,
              },
            },
          },
        ],
      })
      .mockResolvedValue({
        items: [
          {
            agent_id: 'agent-1',
            is_online: true,
            last_seen_at: 1710000220,
            queue_size: 0,
            active_task: null,
            last_task: {
              id: 'task-1',
              agent_id: 'agent-1',
              command: 'scan_now',
              status: 'completed',
              created_at: 1710000200,
              updated_at: 1710000220,
              completed_at: 1710000220,
              ttl_at: 1710000500,
              result: { phase: 'completed', scanned: 4, queued: 1, skipped: 2, jobs_total: 1 },
            },
          },
        ],
      });

    render(<ScanCenter />);

    await waitFor(() => {
      expect(scanAPI.getDashboard).toHaveBeenCalled();
      expect(scanAPI.getBranches).toHaveBeenCalled();
      expect(scanAPI.getAgentsTable).toHaveBeenCalled();
      expect(scanAPI.getHostsTable).toHaveBeenCalled();
    });

    scanAPI.getDashboard.mockClear();
    scanAPI.getAgentsTable.mockClear();
    scanAPI.getHostsTable.mockClear();
    scanAPI.getAgentsActivity.mockClear();

    const agentCell = (await screen.findAllByText('HOST-01')).find((node) => node.closest('tr'));
    const agentRowElement = agentCell.closest('tr');
    const buttons = within(agentRowElement).getAllByRole('button');

    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(scanAPI.createTask).toHaveBeenCalledWith({
        agent_id: 'agent-1',
        command: 'scan_now',
        dedupe_key: 'scan_now:agent-1',
      });
    });

    await waitFor(() => {
      expect(scanAPI.getAgentsActivity).toHaveBeenCalledWith(['agent-1']);
    });

    expect(scanAPI.getDashboard).not.toHaveBeenCalled();
    expect(scanAPI.getAgentsTable).not.toHaveBeenCalled();
    expect(scanAPI.getHostsTable).not.toHaveBeenCalled();
  });

  it('renders completed scan task as finished only after OCR is done', async () => {
    scanAPI.getAgentsTable.mockResolvedValue({
      total: 1,
      items: [
        {
          ...agentRow,
          last_task: {
            id: 'task-1',
            agent_id: 'agent-1',
            command: 'scan_now',
            status: 'completed',
            created_at: 1710000200,
            updated_at: 1710000220,
            completed_at: 1710000220,
            ttl_at: 1710000500,
            result: {
              phase: 'completed',
              scanned: 4,
              queued: 2,
              skipped: 2,
              deferred: 0,
              jobs_total: 2,
              jobs_pending: 0,
              jobs_done_clean: 1,
              jobs_done_with_incident: 1,
              jobs_failed: 0,
            },
          },
        },
      ],
    });

    render(<ScanCenter />);

    await screen.findByText(/Скан: 4 · clean 1 · incidents 1/i);
  });

  it('loads host incidents drawer directly by hostname', async () => {
    render(<ScanCenter />);

    await waitFor(() => {
      expect(scanAPI.getHostsTable).toHaveBeenCalled();
    });

    const hostCell = [...await screen.findAllByText('HOST-01')].reverse().find((node) => node.closest('tr'));
    const hostRowElement = hostCell.closest('tr');
    const viewButton = within(hostRowElement).getByRole('button');

    fireEvent.click(viewButton);

    await waitFor(() => {
      expect(scanAPI.getIncidents).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'HOST-01',
          limit: 5000,
          offset: 0,
        })
      );
    });

    const params = scanAPI.getIncidents.mock.calls[0][0];
    expect(params).not.toHaveProperty('host');
    expect(params).not.toHaveProperty('agentId');
    expect(params).not.toHaveProperty('computer_name');
  });

  it('filters agents and hosts by selected branch from the options list', async () => {
    render(<ScanCenter />);

    const branchInput = await screen.findByLabelText('Филиал');
    fireEvent.mouseDown(branchInput);

    const option = (await screen.findAllByRole('option', { name: 'Тюмень' }))[0];
    fireEvent.click(option);

    await waitFor(() => {
      expect(scanAPI.getAgentsTable).toHaveBeenLastCalledWith(
        expect.objectContaining({ branch: 'Тюмень' })
      );
      expect(scanAPI.getHostsTable).toHaveBeenLastCalledWith(
        expect.objectContaining({ branch: 'Тюмень' })
      );
    });
  });
});
