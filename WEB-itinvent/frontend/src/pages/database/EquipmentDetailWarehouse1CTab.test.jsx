import { describe, expect, it, vi } from 'vitest';

const { getBalancesBatch } = vi.hoisted(() => ({
  getBalancesBatch: vi.fn(),
}));

vi.mock('../../api/warehouse1c', () => ({
  isMeaningful1cRef: (value) => Boolean(String(value || '').trim()),
  isWarehouse1cListIncomplete: (meta = {}) => (
    Boolean(meta?.truncated || meta?.hasMore)
    || ['incomplete', 'unknown', 'error'].includes(String(meta?.status || '').toLowerCase())
  ),
  normalizeWarehouse1cListResponse: (payload) => payload,
  warehouse1cAPI: { getBalancesBatch },
}));

import { filterSuggestionsWithPositiveBalances } from './EquipmentDetailWarehouse1CTab';

describe('filterSuggestionsWithPositiveBalances', () => {
  it('checks unique suggestions with one batch operation instead of a request per item', async () => {
    getBalancesBatch.mockResolvedValue({
      items: [
        { nomenclature_ref: 'nom-1', qty_1c_total: 2, status: 'ok' },
        { nomenclature_ref: 'nom-2', qty_1c_total: 0, status: 'ok' },
      ],
      meta: { status: 'ok' },
    });
    const first = { ref: 'nom-1', name: 'First' };
    const duplicate = { ref: 'nom-1', name: 'Duplicate' };
    const zero = { ref: 'nom-2', name: 'Zero' };

    const result = await filterSuggestionsWithPositiveBalances([first, duplicate, zero]);

    expect(getBalancesBatch).toHaveBeenCalledTimes(1);
    expect(getBalancesBatch).toHaveBeenCalledWith({
      nomenclatureRefs: ['nom-1', 'nom-2'],
      limitPerNomenclature: 20,
    });
    expect(result).toEqual({
      items: [first, duplicate],
      hasUnverified: false,
    });
  });
});
