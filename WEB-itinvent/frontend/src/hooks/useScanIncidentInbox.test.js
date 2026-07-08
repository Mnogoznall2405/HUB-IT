import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScanIncidentInbox } from './useScanIncidentInbox';
import { scanAPI } from '../api/client';

vi.mock('../api/client', () => ({
  scanAPI: {
    getIncidents: vi.fn(),
  },
}));

describe('useScanIncidentInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads only the first page initially and loads more explicitly', async () => {
    scanAPI.getIncidents
      .mockResolvedValueOnce({ items: [{ id: 'i1' }], total: 3, next_offset: 1, has_more: true })
      .mockResolvedValueOnce({ items: [{ id: 'i2' }], total: 3, next_offset: 2, has_more: true });

    const filters = { status: 'new' };
    const { result } = renderHook(() => useScanIncidentInbox(filters, { batchSize: 1 }));

    await waitFor(() => expect(result.current.loaded).toBe(1));
    expect(scanAPI.getIncidents).toHaveBeenCalledTimes(1);
    expect(scanAPI.getIncidents).toHaveBeenNthCalledWith(
      1,
      { status: 'new', limit: 1, offset: 0 },
      expect.objectContaining({ signal: expect.any(Object) }),
    );

    await act(async () => {
      await result.current.loadMore();
    });

    expect(scanAPI.getIncidents).toHaveBeenCalledTimes(2);
    expect(scanAPI.getIncidents).toHaveBeenNthCalledWith(
      2,
      { status: 'new', limit: 1, offset: 1 },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(result.current.items.map((item) => item.id)).toEqual(['i1', 'i2']);
  });
});
