import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INCIDENT_BATCH_SIZE, useScanIncidentInbox } from '../hooks/useScanIncidentInbox';

describe('useScanIncidentInbox', () => {
  let getIncidents;

  beforeEach(() => {
    getIncidents = vi.fn();
  });

  it('uses a smaller default batch size for inbox pages', () => {
    expect(INCIDENT_BATCH_SIZE).toBe(80);
  });

  it('skips fetching when enabled is false', async () => {
    renderHook(() => useScanIncidentInbox(
      { status: 'new' },
      { batchSize: 1, enabled: false, getIncidents },
    ));

    await act(async () => {
      await Promise.resolve();
    });
    expect(getIncidents).not.toHaveBeenCalled();
  });

  it('loads only the first page initially and loads more explicitly', async () => {
    getIncidents
      .mockResolvedValueOnce({ items: [{ id: 'i1' }], total: 3, next_offset: 1, has_more: true })
      .mockResolvedValueOnce({ items: [{ id: 'i2' }], total: 3, next_offset: 2, has_more: true });

    const filters = { status: 'new' };
    const { result } = renderHook(() => useScanIncidentInbox(filters, { batchSize: 1, getIncidents }));

    await waitFor(() => expect(result.current.loaded).toBe(1));
    expect(getIncidents).toHaveBeenCalledTimes(1);
    expect(getIncidents).toHaveBeenNthCalledWith(
      1,
      { status: 'new', limit: 1, offset: 0 },
      expect.objectContaining({ signal: expect.any(Object) }),
    );

    await act(async () => {
      await result.current.loadMore();
    });

    expect(getIncidents).toHaveBeenCalledTimes(2);
    expect(getIncidents).toHaveBeenNthCalledWith(
      2,
      { status: 'new', limit: 1, offset: 1 },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(result.current.items.map((item) => item.id)).toEqual(['i1', 'i2']);
  });
});
