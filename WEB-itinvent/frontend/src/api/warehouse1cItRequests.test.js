import { beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient from './client';
import { warehouse1cItRequestsAPI } from './warehouse1cItRequests';

vi.mock('./client', () => ({
  default: { get: vi.fn() },
}));

describe('warehouse1cItRequestsAPI', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends list filters and keeps overdue absent until enabled', async () => {
    apiClient.get.mockResolvedValue({ data: { items: [] } });

    await warehouse1cItRequestsAPI.getRequests({ view: 'history', search: 'Ippon', stage: 'received' });
    await warehouse1cItRequestsAPI.getRequests({
      overdue: true,
      cursor: 'next-page',
      warehouseRef: 'warehouse-it',
      refresh: true,
    });

    expect(apiClient.get.mock.calls[0][1].params).toMatchObject({
      view: 'history', q: 'Ippon', stage: 'received', warehouse_ref: '', limit: 25, cursor: '', refresh: false,
    });
    expect(apiClient.get.mock.calls[0][1].params).not.toHaveProperty('overdue');
    expect(apiClient.get.mock.calls[1][1].params).toMatchObject({
      overdue: true,
      cursor: 'next-page',
      warehouse_ref: 'warehouse-it',
      refresh: true,
    });
  });

  it('encodes the request reference in the detail URL', async () => {
    apiClient.get.mockResolvedValue({ data: { request_ref: 'ref/1' } });

    await warehouse1cItRequestsAPI.getRequest('ref/1');

    expect(apiClient.get).toHaveBeenCalledWith(
      '/warehouse-1c/it-requests/ref%2F1',
      expect.objectContaining({ timeout: 50_000 }),
    );
  });
});
