import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanCenter from './ScanCenter';
import { scanAPI } from '../api/client';

// Keep in sync with AUTO_REFRESH_MS in ScanCenter.jsx (not exported).
const AUTO_REFRESH_MS = 30_000;

vi.mock('../api/client', () => ({
  scanAPI: {
    getDashboard: vi.fn(),
    getReviewItems: vi.fn(),
    getBranches: vi.fn(),
    getPatterns: vi.fn(),
    getAgentsTable: vi.fn(),
    getAgentsActivity: vi.fn(),
    getHostsTable: vi.fn(),
    getIncidents: vi.fn(),
    getHostScanRuns: vi.fn(),
    getTaskObservations: vi.fn(),
    exportScanTaskIncidents: vi.fn(),
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
  default: ({ children, showDatabaseSelector }) => (
    <div data-testid="main-layout" data-show-database-selector={String(showDatabaseSelector)}>
      {children}
    </div>
  ),
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

const dashboardPayload = {
  totals: {
    agents_total: 1,
    agents_online: 1,
    agents_outdated: 1,
    incidents_new: 1,
    queue_active: 0,
    queue_expired: 0,
    server_pdf_pending: 42,
    server_pdf_queued: 40,
    server_pdf_processing: 2,
    server_pdf_processed: 120,
    server_pdf_done_clean: 100,
    server_pdf_done_with_incident: 18,
    server_pdf_incomplete: 3,
    server_pdf_failed: 2,
  },
  new_hosts: ['HOST-01'],
  expected_agent_version: '1.3.7',
  agent_versions: [{ version: '1.2.8', count: 1 }],
  performance: {
    samples: 120,
    completed: 96,
    throughput_per_hour: 4,
    pending_oldest_age_sec: 90,
    queue_wait_ms: { p50: 500, p95: 1200 },
    processing_ms: { p50: 2800, p95: 6200 },
    ocr_ms: { p50: 2400, p95: 5800 },
    large_pages_downscaled: 2,
    full_effective_dpi_min: 113.6,
    focused_effective_dpi_min: 237.3,
  },
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
    Object.defineProperty(window.URL, 'createObjectURL', {
      writable: true,
      value: vi.fn(() => 'blob:scan-report'),
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      writable: true,
      value: vi.fn(),
    });

    scanAPI.getDashboard.mockReset();
    scanAPI.getReviewItems.mockReset();
    scanAPI.getBranches.mockReset();
    scanAPI.getPatterns.mockReset();
    scanAPI.getAgentsTable.mockReset();
    scanAPI.getAgentsActivity.mockReset();
    scanAPI.getHostsTable.mockReset();
    scanAPI.getIncidents.mockReset();
    scanAPI.getHostScanRuns.mockReset();
    scanAPI.getTaskObservations.mockReset();
    scanAPI.exportScanTaskIncidents.mockReset();
    scanAPI.getTasks.mockReset();
    scanAPI.createTask.mockReset();
    scanAPI.ackIncident.mockReset();
    scanAPI.ackIncidentsBatch.mockReset();

    scanAPI.getDashboard.mockResolvedValue(dashboardPayload);
    scanAPI.getReviewItems.mockResolvedValue({ total: 0, items: [] });
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
    scanAPI.getHostScanRuns.mockResolvedValue({
      total: 1,
      items: [{
        id: 'task-1',
        agent_id: 'agent-1',
        hostname: 'HOST-01',
        command: 'scan_now',
        status: 'completed',
        created_at: 1710000200,
        updated_at: 1710000220,
        completed_at: 1710000220,
        result: { phase: 'completed', scanned: 4, skipped: 1 },
        observation_counts: {
          found_new: 1,
          found_duplicate: 0,
          deleted: 0,
          cleaned: 0,
          moved: 0,
          total: 1,
        },
      }],
    });
    scanAPI.getTaskObservations.mockResolvedValue({ total: 1, items: [] });
    scanAPI.exportScanTaskIncidents.mockResolvedValue({
      data: new Blob(['xlsx']),
      headers: {
        'content-disposition': 'attachment; filename="scan_incidents_HOST-01_task-1.xlsx"',
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
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
    vi.clearAllMocks();
  });

  const openAgentsSection = async () => {
    fireEvent.click(await screen.findByRole('tab', { name: /Агенты/i }));
  };

  const openIncidentsSection = async () => {
    fireEvent.click(await screen.findByRole('tab', { name: /Инциденты/i }));
  };

  const openReviewSection = async () => {
    fireEvent.click(await screen.findByRole('tab', { name: /Не проверено/i }));
  };

  const openHostsSection = async () => {
    fireEvent.click(await screen.findByRole('tab', { name: /Компьютеры/i }));
  };

  it('shows server PDF queue totals on the dashboard', async () => {
    render(<ScanCenter />);

    expect(await screen.findByText('PDF очередь')).toBeInTheDocument();
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    expect(screen.getByText('ждёт: 40 · в работе: 2')).toBeInTheDocument();
    expect(screen.getByText('Обработано PDF')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('чисто: 100 · инциденты: 18 · не проверено: 3 · ошибки: 2')).toBeInTheDocument();
  });

  it('shows measurable queue and OCR performance', async () => {
    render(<ScanCenter />);

    expect(await screen.findByText('Производительность за 24 ч')).toBeInTheDocument();
    expect(screen.getByText('Ожидание очереди p95')).toBeInTheDocument();
    expect(screen.getByText('1.2 с')).toBeInTheDocument();
    expect(screen.getByText('OCR p95')).toBeInTheDocument();
    expect(screen.getByText('5.8 с')).toBeInTheDocument();
    expect(screen.getByText('Крупные страницы')).toBeInTheDocument();
    expect(screen.getByText(/Требуют обновления: 1 агентов/)).toBeInTheDocument();
    expect(screen.getByText(/Ожидаемая версия — 1\.3\.7/)).toBeInTheDocument();
  });

  it('shows the three-page OCR policy and incomplete files', async () => {
    scanAPI.getReviewItems.mockResolvedValue({
      total: 1,
      items: [{
        id: 'job-incomplete',
        hostname: 'HOST-02',
        file_path: 'C:\\Docs\\broken.pdf',
        reason: 'OCR timeout',
      }],
    });

    render(<ScanCenter />);

    expect(await screen.findByText(/OCR — первые 3 страницы; текстовый слой — до 10 страниц/)).toBeInTheDocument();
    expect(await screen.findByText(/HOST-02 · C:\\Docs\\broken.pdf/)).toBeInTheDocument();
    expect(screen.getByText('OCR timeout')).toBeInTheDocument();
  });

  it('shows incomplete files separately and offers an explicit force rescan', async () => {
    scanAPI.getReviewItems.mockResolvedValue({
      total: 1,
      items: [{
        id: 'job-incomplete-retry',
        agent_id: 'agent-1',
        hostname: 'HOST-RETRY',
        file_path: 'C:\\Docs\\unreadable.pdf',
        reason: 'OCR timeout',
        extraction_outcomes: [{ page: 1, outcome: 'timeout' }],
      }],
    });

    render(<ScanCenter />);
    await openReviewSection();

    expect(await screen.findByText('C:\\Docs\\unreadable.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Превышено время анализа/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Пересканировать ПК/i }));

    expect(await screen.findByText('Какие файлы проверять')).toBeInTheDocument();
  });

  it('shows database selector in the main layout header', async () => {
    render(<ScanCenter />);

    expect(await screen.findByTestId('main-layout')).toHaveAttribute('data-show-database-selector', 'true');
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
        payload: expect.objectContaining({
          agent_pattern_ids: ['password_strict', 'loan_keyword'],
          scan_extensions: expect.arrayContaining(['.pdf', '.jpg', '.txt']),
          server_pdf_pattern_ids: ['password_strict', 'loan_keyword'],
        }),
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
        payload: expect.objectContaining({
          force_rescan: true,
          agent_pattern_ids: ['password_strict', 'loan_keyword'],
          scan_extensions: expect.arrayContaining(['.pdf', '.jpg', '.txt']),
          server_pdf_pattern_ids: ['password_strict', 'loan_keyword'],
        }),
        dedupe_key: 'scan_now_force:agent-1',
      });
    });
  });

  it('keeps expensive Office conversion optional in the scan dialog', async () => {
    render(<ScanCenter />);

    await openAgentsSection();
    const agentCell = (await screen.findAllByText('HOST-01')).find((node) => node.closest('tr'));
    fireEvent.click(within(agentCell.closest('tr')).getAllByRole('button')[0]);

    expect(await screen.findByText('Какие файлы проверять')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Office и ODF/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^PDF/i })).toBeChecked();
  });

  it('uses one DSP checkbox to send every internal DSP rule', async () => {
    const dspPatternIds = [
      'dsp_official_use',
      'dsp_ocr_variant',
      'dsp_ocr_context',
      'dsp_with_exclusion',
    ];
    scanAPI.getPatterns.mockResolvedValueOnce({
      total: 5,
      items: [
        ...dspPatternIds.map((id, index) => ({
          id,
          name: `Техническое правило ДСП ${index + 1}`,
          category: 'Грифы и секретность',
          weight: index === 0 ? 1 : 0.8,
          enabled_by_default: true,
          incident_filter_id: 'dsp',
          incident_filter_name: 'ДСП',
        })),
        { id: 'loan_keyword', name: 'Займ', category: 'Финансы', weight: 0.8, enabled_by_default: true },
      ],
    });
    render(<ScanCenter />);
    await openAgentsSection();
    const agentCell = (await screen.findAllByText('HOST-01')).find((node) => node.closest('tr'));
    fireEvent.click(within(agentCell.closest('tr')).getAllByRole('button')[0]);

    const dspCheckboxes = await screen.findAllByRole('checkbox', { name: /^ДСП/i });
    expect(dspCheckboxes).toHaveLength(1);
    expect(dspCheckboxes[0]).toBeChecked();
    expect(screen.getByText(/Используются 4 внутренних правила/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Снять все/i }));
    expect(dspCheckboxes[0]).not.toBeChecked();
    fireEvent.click(dspCheckboxes[0]);
    expect(dspCheckboxes[0]).toBeChecked();
    fireEvent.click(await screen.findByRole('button', { name: /Запустить/i }));

    await waitFor(() => {
      expect(scanAPI.createTask).toHaveBeenCalledWith(expect.objectContaining({
        payload: expect.objectContaining({
          agent_pattern_ids: dspPatternIds,
          server_pdf_pattern_ids: dspPatternIds,
        }),
      }));
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
          limit: 200,
          offset: 0,
        })
      );
    });

    const params = scanAPI.getIncidents.mock.calls.find(([callParams]) => callParams?.hostname === 'HOST-01')?.[0];
    expect(params).not.toHaveProperty('host');
    expect(params).not.toHaveProperty('agentId');
    expect(params).not.toHaveProperty('computer_name');
  });

  it('exports incidents report for a selected scan run', async () => {
    render(<ScanCenter />);

    await waitFor(() => {
      expect(scanAPI.getHostsTable).toHaveBeenCalled();
    });

    await openHostsSection();

    const hostCell = [...await screen.findAllByText('HOST-01')].reverse().find((node) => node.closest('tr'));
    const hostRowElement = hostCell.closest('tr');
    fireEvent.click(within(hostRowElement).getByRole('button'));

    await waitFor(() => {
      expect(scanAPI.getHostScanRuns).toHaveBeenCalledWith('HOST-01', { limit: 30, offset: 0 });
    });

    const exportButton = (await screen.findAllByRole('button', { name: /Excel/i, hidden: true })).at(-1);
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(scanAPI.exportScanTaskIncidents).toHaveBeenCalledWith('task-1');
    });
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('loads incident inbox first page and loads more explicitly', async () => {
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

    await openIncidentsSection();

    await waitFor(() => {
      expect(scanAPI.getIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500, offset: 0 }),
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });
    expect(scanAPI.getIncidents).not.toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500, offset: 500 }),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(await screen.findByText('HOST-BATCH')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /Загрузить/i }));

    await waitFor(() => {
      expect(scanAPI.getIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500, offset: 500 }),
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });
  });

  it('auto-refreshes the inbox first page after loadMore (regression for stale auto-refresh closure)', async () => {
    // Regression test for a bug where `refreshAll` (called from the
    // AUTO_REFRESH_MS interval) was not wrapped so the interval callback
    // kept the version of the function captured on mount, when
    // `incidentInbox.loaded` was still 0 - so it always skipped refreshing
    // the inbox first page, even long after items had been loaded via
    // "loadMore". The fix routes the interval callback through a ref that
    // always points at the latest `refreshAll` closure.
    const firstPage = Array.from({ length: 500 }, (_, idx) => ({
      ...incidentRow,
      id: `incident-${idx}`,
      hostname: 'HOST-BATCH',
      created_at: 1710000100 - idx,
    }));
    const secondPage = [{ ...incidentRow, id: 'incident-500', hostname: 'HOST-BATCH', created_at: 1709999600 }];
    scanAPI.getIncidents.mockImplementation((params = {}) => {
      if (Number(params.offset || 0) === 500) {
        return Promise.resolve({ total: 501, items: secondPage, limit: 500, offset: 500, has_more: false, next_offset: null });
      }
      return Promise.resolve({ total: 501, items: firstPage, limit: 500, offset: 0, has_more: true, next_offset: 500 });
    });

    // Only fake setInterval/clearInterval, and do it *before* mount so the
    // AUTO_REFRESH_MS interval created by ScanCenter's effect is itself a
    // fake timer we can fast-forward deterministically. Testing Library's
    // own waitFor/findBy still work because they primarily rely on a
    // MutationObserver (unaffected by faking timers) rather than the
    // setInterval fallback, as long as the awaited condition corresponds to
    // an actual DOM mutation.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      render(<ScanCenter />);

      await openIncidentsSection();

      await waitFor(() => {
        expect(scanAPI.getIncidents).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 500, offset: 0 }),
          expect.objectContaining({ signal: expect.any(Object) }),
        );
      });
      expect(await screen.findByText('HOST-BATCH')).toBeTruthy();

      fireEvent.click(await screen.findByRole('button', { name: /Загрузить/i }));
      await waitFor(() => {
        expect(scanAPI.getIncidents).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 500, offset: 500 }),
          expect.objectContaining({ signal: expect.any(Object) }),
        );
      });

      // `incidentInbox.loaded` is now 501 (> 0), so the *next* auto-refresh
      // tick must call getIncidents again with offset 0 and the full inbox
      // page size to refresh the first page. Match on `limit: 500` too so
      // this doesn't accidentally count the separate, always-refreshed
      // "new incidents count" query (batchSize 1, status 'new').
      const isMainInboxFirstPageCall = ([params]) => (
        Number(params?.offset || 0) === 0 && Number(params?.limit || 0) === 500
      );
      const offsetZeroCallsBefore = scanAPI.getIncidents.mock.calls.filter(isMainInboxFirstPageCall).length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS);
      });

      const offsetZeroCallsAfter = scanAPI.getIncidents.mock.calls.filter(isMainInboxFirstPageCall).length;
      expect(offsetZeroCallsAfter).toBeGreaterThan(offsetZeroCallsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('acknowledges the current incident inbox filter with one batch request', async () => {
    render(<ScanCenter />);

    await openIncidentsSection();

    await waitFor(() => {
      expect(scanAPI.getIncidents).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Просмотрено по фильтру/i }));
    expect(await screen.findByText(/включая ещё не загруженные строки списка/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Отметить просмотренными/i }));

    await waitFor(() => {
      expect(scanAPI.ackIncidentsBatch).toHaveBeenCalledWith({
        filters: expect.objectContaining({}),
        confirm_all: true,
      });
    });
  });

  it('filters findings by the selected scan pattern', async () => {
    render(<ScanCenter />);
    await openIncidentsSection();

    fireEvent.mouseDown(await screen.findByLabelText('Тип находки'));
    fireEvent.click((await screen.findAllByRole('option', { name: 'Займ' }))[0]);

    await waitFor(() => {
      expect(scanAPI.getIncidents).toHaveBeenLastCalledWith(
        expect.objectContaining({ pattern_id: 'loan_keyword' }),
        expect.any(Object),
      );
    });
  });

  it('shows all DSP detection rules as one findings filter', async () => {
    scanAPI.getPatterns.mockResolvedValueOnce({
      total: 5,
      items: [
        { id: 'dsp_official_use', name: 'ДСП (Для служебного пользования)', incident_filter_id: 'dsp', incident_filter_name: 'ДСП' },
        { id: 'dsp_ocr_variant', name: 'ДСП (OCR-искажённая фраза, требует проверки)', incident_filter_id: 'dsp', incident_filter_name: 'ДСП' },
        { id: 'dsp_ocr_context', name: 'ДСП (повреждённый OCR-гриф с контекстом, требует проверки)', incident_filter_id: 'dsp', incident_filter_name: 'ДСП' },
        { id: 'dsp_with_exclusion', name: 'ДСП (сокращение, требует проверки)', incident_filter_id: 'dsp', incident_filter_name: 'ДСП' },
        { id: 'loan_keyword', name: 'Займ', incident_filter_id: 'loan_keyword', incident_filter_name: 'Займ' },
      ],
    });
    render(<ScanCenter />);
    await openIncidentsSection();

    fireEvent.mouseDown(await screen.findByLabelText('Тип находки'));
    const dspOptions = await screen.findAllByRole('option', { name: 'ДСП' });
    expect(dspOptions).toHaveLength(1);
    expect(screen.queryByRole('option', { name: /OCR-искажённая фраза/i })).not.toBeInTheDocument();
    fireEvent.click(dspOptions[0]);

    await waitFor(() => {
      expect(scanAPI.getIncidents).toHaveBeenLastCalledWith(
        expect.objectContaining({ pattern_id: 'dsp' }),
        expect.any(Object),
      );
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
