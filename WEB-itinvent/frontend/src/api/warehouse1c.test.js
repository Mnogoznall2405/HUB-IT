import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiClientMock } = vi.hoisted(() => ({
  apiClientMock: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  default: apiClientMock,
}));

import {
  isWarehouse1cListIncomplete,
  normalizeWarehouse1cListResponse,
  warehouse1cAPI,
} from './warehouse1c';

describe('warehouse 1C list response normalization', () => {
  it('keeps legacy array responses usable', () => {
    const response = normalizeWarehouse1cListResponse([{ nomenclature_code: 'PN-1' }]);

    expect(response).toEqual({
      items: [{ nomenclature_code: 'PN-1' }],
      meta: { returned: 1 },
    });
    expect(isWarehouse1cListIncomplete(response.meta)).toBe(false);
  });

  it('reads top-level and nested metadata from the hardened envelope', () => {
    const response = normalizeWarehouse1cListResponse({
      items: [{ nomenclature_code: 'PN-1' }],
      returned: 1,
      total: 5,
      has_more: true,
      meta: {
        truncated: true,
        as_of: '2026-07-13T10:00:00Z',
        source: 'buh20',
        status: 'incomplete',
      },
    });

    expect(response).toEqual({
      items: [{ nomenclature_code: 'PN-1' }],
      meta: {
        status: 'incomplete',
        returned: 1,
        total: 5,
        hasMore: true,
        truncated: true,
        asOf: '2026-07-13T10:00:00Z',
        source: 'buh20',
      },
    });
    expect(isWarehouse1cListIncomplete(response.meta)).toBe(true);
  });
});

describe('warehouse 1C API contracts', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
    apiClientMock.post.mockResolvedValue({ data: { ok: true } });
  });

  it('requests a wider default nomenclature page so relevant matches are not hidden at 20', async () => {
    await warehouse1cAPI.searchNomenclature('m70');

    expect(apiClientMock.get).toHaveBeenCalledWith('/warehouse-1c/nomenclature/search', {
      params: { q: 'm70', limit: 50 },
      timeout: 50_000,
    });
  });

  it('requests metadata for balances and movements without changing legacy response handling', async () => {
    await warehouse1cAPI.getBalances({ nomenclatureRef: 'nom-1' });
    await warehouse1cAPI.getMovements({ nomenclatureRef: 'nom-1' });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/warehouse-1c/balances', {
      params: {
        nomenclature_ref: 'nom-1',
        warehouse_ref: '',
        q: '',
        limit: 200,
        include_meta: true,
      },
      timeout: 50_000,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/warehouse-1c/movements', {
      params: {
        nomenclature_ref: 'nom-1',
        warehouse_ref: '',
        series_ref: '',
        date_from: '',
        date_to: '',
        limit: 500,
        include_meta: true,
      },
      timeout: 50_000,
    });
  });

  it('uses one bounded batch request for up to 50 unique nomenclature refs', async () => {
    await warehouse1cAPI.getBalancesBatch({
      nomenclatureRefs: ['nom-1', 'nom-1', 'nom-2'],
      warehouseRef: 'warehouse-1',
      limitPerNomenclature: 20,
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/warehouse-1c/balances/batch', {
      nomenclature_refs: ['nom-1', 'nom-2'],
      warehouse_ref: 'warehouse-1',
      limit_per_nomenclature: 20,
    }, { timeout: 50_000 });
  });

  it('refuses an over-limit batch locally rather than silently dropping nomenclature refs', async () => {
    const refs = Array.from({ length: 51 }, (_, index) => `nom-${index}`);

    await expect(warehouse1cAPI.getBalancesBatch({ nomenclatureRefs: refs }))
      .rejects.toThrow('не более 50');
    expect(apiClientMock.post).not.toHaveBeenCalled();
  });

  it('reads the server-side reconcile rollout state before exposing writes', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: { reconcile: { write_enabled: false, mode: 'audit_only' } },
    });

    const status = await warehouse1cAPI.getRuntimeStatus();

    expect(status.reconcile.write_enabled).toBe(false);
    expect(apiClientMock.get).toHaveBeenCalledWith('/warehouse-1c/status', {
      timeout: 50_000,
    });
  });

  it('passes the keyset cursor for the next hub-over-1C page', async () => {
    await warehouse1cAPI.getReconcileHubOver1c({ limit: 25, cursor: 'PN-1|INV-10' });

    expect(apiClientMock.get).toHaveBeenCalledWith('/warehouse-1c/reconcile/hub-over-1c', {
      params: { limit: 25, cursor: 'PN-1|INV-10' },
      timeout: 50_000,
    });
  });

  it('sends typed individual reconcile writes without a client-selected hub database', async () => {
    await warehouse1cAPI.applyReconcilePartNo({
      invNo: 'INV-1',
      nomenclatureRef: 'nom-1',
      partNo: 'PN-1',
      reason: 'manual review',
      expectedPartNo: '',
      confirm: true,
    });
    await warehouse1cAPI.markReconcileNotIn1c({
      invNo: 'INV-1',
      reason: 'manual review',
      expectedPartNo: 'PN-1',
      confirm: true,
    });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/warehouse-1c/reconcile/apply-part-no', {
      inv_no: 'INV-1',
      nomenclature_ref: 'nom-1',
      part_no: 'PN-1',
      reason: 'manual review',
      expected_part_no: '',
      expected_version: 0,
      confirm: true,
    }, { timeout: 50_000 });
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/warehouse-1c/reconcile/mark-not-in-1c', {
      inv_no: 'INV-1',
      reason: 'manual review',
      expected_part_no: 'PN-1',
      expected_version: 0,
      confirm: true,
    }, { timeout: 50_000 });
  });

  it('keeps auto-link client calls preview-only', async () => {
    await warehouse1cAPI.autoLinkReconcile({ limit: 10 });

    expect(apiClientMock.post).toHaveBeenCalledWith('/warehouse-1c/reconcile/auto-link', {
      limit: 10,
      dry_run: true,
    }, { timeout: 50_000 });
    await expect(warehouse1cAPI.autoLinkReconcile({ dryRun: false }))
      .rejects.toThrow('только как предпросмотр');
    expect(apiClientMock.post).toHaveBeenCalledTimes(1);
  });
});
