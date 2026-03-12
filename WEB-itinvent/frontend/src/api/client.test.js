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

