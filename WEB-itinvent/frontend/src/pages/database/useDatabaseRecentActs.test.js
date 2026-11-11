import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDatabaseRecentActs } from './useDatabaseRecentActs';

const getRecentActs = vi.fn();
const touchRecentAct = vi.fn();
const removeRecentAct = vi.fn();
const clearRecentActs = vi.fn();

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    getRecentActs: (...args) => getRecentActs(...args),
    touchRecentAct: (...args) => touchRecentAct(...args),
    removeRecentAct: (...args) => removeRecentAct(...args),
    clearRecentActs: (...args) => clearRecentActs(...args),
  },
}));

describe('useDatabaseRecentActs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentActs.mockResolvedValue({
      items: [{ doc_no: 11, doc_number: 'A-11', snapshot: { employee_name: 'Ivanov' } }],
    });
    touchRecentAct.mockResolvedValue({
      doc_no: 12,
      doc_number: 'A-12',
      snapshot: { employee_name: 'Petrov' },
    });
    removeRecentAct.mockResolvedValue({ removed: 1 });
    clearRecentActs.mockResolvedValue({ removed: 1 });
  });

  it('loads recent acts when enabled', async () => {
    const { result } = renderHook(() => useDatabaseRecentActs({
      enabled: true,
      dbName: 'main',
    }));

    await waitFor(() => {
      expect(getRecentActs).toHaveBeenCalledWith({ limit: 8 });
      expect(result.current.recentActs).toHaveLength(1);
    });
  });

  it('touches and upserts an act locally', async () => {
    const { result } = renderHook(() => useDatabaseRecentActs({
      enabled: true,
      dbName: 'main',
    }));

    await waitFor(() => expect(result.current.recentActs).toHaveLength(1));

    await act(async () => {
      await result.current.touchRecentAct({
        docNo: 12,
        docNumber: 'A-12',
        actionType: 'view',
        snapshot: { employee_name: 'Petrov' },
      });
    });

    expect(touchRecentAct).toHaveBeenCalledWith({
      docNo: 12,
      docNumber: 'A-12',
      actionType: 'view',
      snapshot: { employee_name: 'Petrov' },
    });
    expect(result.current.recentActs[0].doc_no).toBe(12);
  });

  it('keeps warm cache when temporarily disabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useDatabaseRecentActs({ enabled, dbName: 'main' }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.recentActs).toHaveLength(1));

    rerender({ enabled: false });

    await waitFor(() => {
      expect(result.current.recentActsLoading).toBe(false);
      expect(result.current.recentActs).toHaveLength(1);
    });
  });
});

