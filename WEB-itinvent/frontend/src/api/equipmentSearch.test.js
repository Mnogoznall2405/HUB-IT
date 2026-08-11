import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiClientMock } = vi.hoisted(() => ({
  apiClientMock: { get: vi.fn() },
}));

vi.mock('./client', () => ({ default: apiClientMock }));

import { equipmentSearchAPI } from './equipmentSearch';

describe('equipment search API', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { employees: [] } });
  });

  it('passes AbortSignal only when the caller supplies it', async () => {
    const controller = new AbortController();

    await equipmentSearchAPI.searchByEmployee('Иванов', 1, 10, { signal: controller.signal });
    await equipmentSearchAPI.searchByEmployee('Петров');

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/search/employee', {
      params: { q: 'Иванов', page: 1, limit: 10 },
      signal: controller.signal,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/search/employee', {
      params: { q: 'Петров', page: 1, limit: 50 },
    });
  });
});
