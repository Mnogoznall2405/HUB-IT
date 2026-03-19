import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = {
  get: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => apiClientMock),
  },
}));

describe('equipmentAPI.getAgentComputers', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
    window.localStorage.clear();
  });

  it('maps supported filter options to backend query params', async () => {
    const { equipmentAPI } = await import('./client');

    await equipmentAPI.getAgentComputers({
      scope: 'all',
      branch: 'Тюмень',
      status: 'online',
      outlookStatus: 'warning',
      q: 'petrov',
      changedOnly: true,
      sortBy: 'hostname',
      sortDir: 'desc',
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/inventory/computers', {
      params: {
        scope: 'all',
        branch: 'Тюмень',
        status: 'online',
        outlook_status: 'warning',
        q: 'petrov',
        changed_only: true,
        sort_by: 'hostname',
        sort_dir: 'desc',
      },
    });
  });
});

describe('networksAPI.exportMapPdf', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: new Blob([]),
      headers: { 'content-type': 'application/pdf' },
    });
  });

  it('requests backend PDF export for the selected map', async () => {
    const { networksAPI } = await import('./client');

    await networksAPI.exportMapPdf(17);

    expect(apiClientMock.get).toHaveBeenCalledWith('/networks/maps/17/export-pdf', {
      params: {},
      responseType: 'blob',
    });
  });
});

describe('scanAPI table endpoints', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { total: 1, items: [] } });
  });

  it('requests paginated agents table data with server-side filters', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.getAgentsTable({
      q: 'host-01',
      branch: 'Тюмень',
      online: 'online',
      task_status: 'active',
      limit: 25,
      offset: 50,
      sort_by: 'online',
      sort_dir: 'desc',
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/agents/table', {
      params: {
        q: 'host-01',
        branch: 'Тюмень',
        online: 'online',
        task_status: 'active',
        limit: 25,
        offset: 50,
        sort_by: 'online',
        sort_dir: 'desc',
      },
    });
  });

  it('loads branch options for scan center filter', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.getBranches();

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/branches');
  });

  it('requests paginated host and task data without client-side fallbacks', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.getHostsTable({
      q: 'host-02',
      branch: 'Москва',
      status: 'new',
      severity: 'high',
      limit: 100,
      offset: 0,
      sort_by: 'incidents_new',
      sort_dir: 'desc',
    });
    await scanAPI.getTasks({
      agent_id: 'agent-1',
      status: 'active',
      command: 'scan_now',
      limit: 20,
      offset: 0,
    });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/scan/hosts/table', {
      params: {
        q: 'host-02',
        branch: 'Москва',
        status: 'new',
        severity: 'high',
        limit: 100,
        offset: 0,
        sort_by: 'incidents_new',
        sort_dir: 'desc',
      },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/scan/tasks', {
      params: {
        agent_id: 'agent-1',
        status: 'active',
        command: 'scan_now',
        limit: 20,
        offset: 0,
      },
    });
  });
});
