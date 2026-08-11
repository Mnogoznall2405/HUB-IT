import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBalancesBatch, getBalancesWithHub, searchNomenclature, suggestNomenclature } = vi.hoisted(() => ({
  getBalancesBatch: vi.fn(),
  getBalancesWithHub: vi.fn(),
  searchNomenclature: vi.fn(),
  suggestNomenclature: vi.fn(),
}));

vi.mock('../../api/warehouse1c', () => ({
  isMeaningful1cRef: (value) => Boolean(String(value || '').trim()),
  isWarehouse1cListIncomplete: (meta = {}) => (
    Boolean(meta?.truncated || meta?.hasMore)
    || ['incomplete', 'unknown', 'error'].includes(String(meta?.status || '').toLowerCase())
  ),
  normalizeWarehouse1cListResponse: (payload) => ({
    items: Array.isArray(payload) ? payload : (payload?.items || []),
    meta: Array.isArray(payload) ? {} : (payload?.meta || {}),
  }),
  warehouse1cAPI: {
    getBalancesBatch,
    getBalancesWithHub,
    searchNomenclature,
    suggestNomenclature,
  },
}));

import EquipmentDetailWarehouse1CTab, {
  filterSuggestionsWithPositiveBalances,
} from './EquipmentDetailWarehouse1CTab';

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('EquipmentDetailWarehouse1CTab balance requests', () => {
  it('ignores an older response after another nomenclature was selected', async () => {
    let resolveFirst;
    let resolveSecond;
    const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
    const secondResponse = new Promise((resolve) => { resolveSecond = resolve; });

    searchNomenclature.mockResolvedValue([
      { ref: 'nom-1', code: 'ONE', name: 'First nomenclature' },
      { ref: 'nom-2', code: 'TWO', name: 'Second nomenclature' },
    ]);
    getBalancesBatch.mockResolvedValue({
      items: [
        { nomenclature_ref: 'nom-1', qty_1c_total: 1, status: 'ok' },
        { nomenclature_ref: 'nom-2', qty_1c_total: 1, status: 'ok' },
      ],
      meta: { status: 'ok' },
    });
    getBalancesWithHub
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => secondResponse);

    render(
      <MemoryRouter>
        <EquipmentDetailWarehouse1CTab
          active
          data={{ MODEL_NAME: 'Xerox VersaLink B605' }}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('First nomenclature'));
    fireEvent.click(screen.getByText('Second nomenclature'));

    await act(async () => {
      resolveSecond({
        items: [{ warehouse_ref: 'w-new', warehouse_name: 'Latest owner', qty_balance: 0, hub_count: 0 }],
        meta: { status: 'ok' },
      });
    });
    expect(await screen.findByText('Latest owner')).toBeInTheDocument();

    await act(async () => {
      resolveFirst({
        items: [{ warehouse_ref: 'w-old', warehouse_name: 'Stale owner', qty_balance: 0, hub_count: 4 }],
        meta: { status: 'ok' },
      });
    });

    expect(screen.queryByText('Stale owner')).not.toBeInTheDocument();
    expect(screen.getByText('Latest owner')).toBeInTheDocument();
  });
});
