import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanCenter from './ScanCenter';
import { scanAPI } from '../api/client';

vi.mock('../api/client', () => ({
  scanAPI: {
    getDashboard: vi.fn(),
    getBranches: vi.fn(),
    getPatterns: vi.fn(),
    getAgentsTable: vi.fn(),
    getAgentsActivity: vi.fn(),
    getHostsTable: vi.fn(),
    getIncidents: vi.fn(),
    getTasks: vi.fn(),
    createTask: vi.fn(),
    ackIncident: vi.fn(),
    ackIncidentsBatch: vi.fn(),
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
    scanAPI.getPatterns.mockReset();
    scanAPI.getAgentsTable.mockReset();
    scanAPI.getAgentsActivity.mockReset();
    scanAPI.getHostsTable.mockReset();
    scanAPI.getIncidents.mockReset();
    scanAPI.getTasks.mockReset();
    scanAPI.createTask.mockReset();
    scanAPI.ackIncident.mockReset();
    scanAPI.ackIncidentsBatch.mockReset();

    scanAPI.getDashboard.mockResolvedValue(dashboardPayload);
    scanAPI.getBranches.mockResolvedValue(['Тюмень', 'Москва']);
    scanAPI.getPatterns.mockResolvedValue({
      total: 2,
      items: [
        { id: 'password_strict', name: 'Пароль', category: 'Учетные данные', weight: 1, enabled_by_default: true },
        { id: 'loan_keyword', name: 'Займ', category: 'Финансы', weight: 0.8, enabled_by_default: true },
      ],
    });
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
    scanAPI.ackIncidentsBatch.mockResolvedValue({ success: true, acked_count: 1, total_matched: 1 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const openAgentsSection = async () => {
    fireEvent.click(await screen.findByRole('tab', { name: /Агенты/i }));
  };

  const openHostsSection = async () => {
    fireEvent.click(await screen.findByRole('tab', { name: /Хосты/i }));
  };

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

    await openAgentsSection();

    const agentCell = (await screen.findAllByText('HOST-01')).find((node) => node.closest('tr'));
    const agentRowElement = agentCell.closest('tr');
    const buttons = within(agentRowElement).getAllByRole('button');

    fireEvent.click(buttons[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Запустить/i }));

    await waitFor(() => {
      expect(scanAPI.createTask).toHaveBeenCalledWith({
        agent_id: 'agent-1',
        command: 'scan_now',
        payload: { server_pdf_pattern_ids: ['password_strict', 'loan_keyword'] },
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

  it('creates force rescan task with selected PDF patterns', async () => {
    render(<ScanCenter />);

    await waitFor(() => {
      expect(scanAPI.getAgentsTable).toHaveBeenCalled();
    });

    await openAgentsSection();

    const agentCell = (await screen.findAllByText('HOST-01')).find((node) => node.closest('tr'));
    const agentRowElement = agentCell.closest('tr');
    const buttons = within(agentRowElement).getAllByRole('button');

    fireEvent.click(buttons[1]);
    fireEvent.click(await screen.findByRole('button', { name: /Запустить/i }));

    await waitFor(() => {
      expect(scanAPI.createTask).toHaveBeenCalledWith({
        agent_id: 'agent-1',
        command: 'scan_now',
        payload: { force_rescan: true, server_pdf_pattern_ids: ['password_strict', 'loan_keyword'] },
        dedupe_key: 'scan_now_force:agent-1',
      });
    });
  });

  it('disables scan commands while an agent has an active task', async () => {
    scanAPI.getAgentsTable.mockResolvedValue({
      total: 1,
      items: [
        {
          ...agentRow,
          active_task: {
            id: 'task-active',
            agent_id: 'agent-1',
            command: 'scan_now',
            status: 'acknowledged',
            created_at: 1710000200,
            updated_at: 1710000200,
            ttl_at: 1710000500,
            result: { phase: 'server_processing', scanned: 1, queued: 1, jobs_total: 1, jobs_pending: 1 },
          },
        },
      ],
    });

    render(<ScanCenter />);

    await openAgentsSection();

    const agentCell = (await screen.findAllByText('HOST-01')).find((node) => node.closest('tr'));
    const agentRowElement = agentCell.closest('tr');
    const buttons = within(agentRowElement).getAllByRole('button');

    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();
    expect(buttons[2]).toBeDisabled();
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

    await openAgentsSection();

    await screen.findByText(/Скан: проверено 4 · без инцидентов 1 · с инцидентами 1/i);
  });

  it('renders force scan summary counters', async () => {
    scanAPI.getAgentsTable.mockResolvedValue({
      total: 1,
      items: [
        {
          ...agentRow,
          last_task: {
            id: 'task-force',
            agent_id: 'agent-1',
            command: 'scan_now',
            status: 'completed',
            created_at: 1710000200,
            updated_at: 1710000220,
            completed_at: 1710000220,
            ttl_at: 1710000500,
            result: {
              phase: 'completed',
              force_rescan: true,
              scanned: 4,
              queued: 0,
              skipped: 1,
              deduped: 3,
              deleted_from_state: 2,
              jobs_total: 0,
            },
          },
        },
      ],
    });

    render(<ScanCenter />);

    await openAgentsSection();

    await screen.findByText(/Скан с 0: проверено 4 .* дубли: 3 .* удалено из учета: 2/i);
    await screen.findByText(/Скан с 0 · Завершено/i);
  });

  it('loads host incidents drawer directly by hostname', async () => {
    render(<ScanCenter />);

    await waitFor(() => {
      expect(scanAPI.getHostsTable).toHaveBeenCalled();
    });

    await openHostsSection();

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

    const params = scanAPI.getIncidents.mock.calls.find(([callParams]) => callParams?.hostname === 'HOST-01')?.[0];
    expect(params).not.toHaveProperty('host');
    expect(params).not.toHaveProperty('agentId');
    expect(params).not.toHaveProperty('computer_name');
  });

  it('loads incident inbox in 500-row batches and renders grouped host rows', async () => {
    const firstPage = Array.from({ length: 500 }, (_, idx) => ({
      ...incidentRow,
      id: `incident-${idx}`,
      hostname: 'HOST-BATCH',
      file_path: `C:\\Docs\\secret-${idx}.pdf`,
      file_name: `secret-${idx}.pdf`,
      created_at: 1710000100 - idx,
    }));
    const secondPage = [{
      ...incidentRow,
      id: 'incident-500',
      hostname: 'HOST-BATCH',
      file_path: 'C:\\Docs\\secret-500.pdf',
      file_name: 'secret-500.pdf',
      created_at: 1709999600,
    }];
    scanAPI.getIncidents.mockImplementation((params = {}) => {
      if (Number(params.offset || 0) === 500) {
        return Promise.resolve({ total: 501, items: secondPage, limit: 500, offset: 500, has_more: false, next_offset: null });
      }
      return Promise.resolve({ total: 501, items: firstPage, limit: 500, offset: 0, has_more: true, next_offset: 500 });
    });

    render(<ScanCenter />);

    await waitFor(() => {
      expect(scanAPI.getIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500, offset: 0 }),
        expect.objectContaining({ signal: expect.any(Object) }),
      );
      expect(scanAPI.getIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500, offset: 500 }),
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });
    expect(await screen.findByText('HOST-BATCH')).toBeTruthy();
  });

  it('acknowledges the current incident inbox filter with one batch request', async () => {
    render(<ScanCenter />);

    await screen.findByText('HOST-01');
    fireEvent.click(screen.getByRole('button', { name: /Просмотрено по фильтру/i }));

    await waitFor(() => {
      expect(scanAPI.ackIncidentsBatch).toHaveBeenCalledWith({
        filters: expect.objectContaining({}),
        ack_by: 'web-user',
      });
    });
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
