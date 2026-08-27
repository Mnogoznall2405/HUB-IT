import apiClient from './client';
import {
  getWarehouse1CCatalogStatus,
  normalizeWarehouse1CCatalogItems,
  searchWarehouse1CCatalog,
} from './warehouse1cApi';

jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));
const client = apiClient as unknown as { get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('normalizes only the bounded public catalog status fields', async () => {
  client.get.mockResolvedValue({ data: {
    status: 'stale', nomenclature_count: '120', warehouses_count: 7,
    updated_at: '2026-08-24T10:00:00Z', age_seconds: '9000', stale_after_seconds: 7200,
    nomenclature_truncated: false, warehouses_truncated: true, sync_in_progress: true,
    complete: false, source: 'app_db_indexed_snapshot', app_snapshot: { secret: 'not exposed' },
  } });
  await expect(getWarehouse1CCatalogStatus()).resolves.toEqual({
    status: 'stale', nomenclature_count: 120, warehouses_count: 7,
    updated_at: '2026-08-24T10:00:00Z', age_seconds: 9000, stale_after_seconds: 7200,
    nomenclature_truncated: false, warehouses_truncated: true, sync_in_progress: true,
    complete: false, source: 'app_db_indexed_snapshot',
  });
  expect(client.get).toHaveBeenCalledWith('/warehouse-1c/catalog/status', {
    signal: undefined,
    timeout: 50_000,
  });
});

it('drops malformed and zero-ref rows, deduplicates refs and enforces the response cap', () => {
  expect(normalizeWarehouse1CCatalogItems([
    { ref: 'ref-1', code: 'A', name: 'Монитор' },
    { ref: 'REF-1', code: 'B', name: 'Дубликат' },
    { ref: '00000000-0000-0000-0000-000000000000', name: 'Пустая ссылка' },
    { ref: 'ref-2', name: '' },
    { ref: 'ref-3', name: 'Принтер' },
  ], 2)).toEqual([
    { ref: 'ref-1', code: 'A', name: 'Монитор' },
    { ref: 'ref-3', code: '', name: 'Принтер' },
  ]);
});

it('does not call the server before two characters and caps search parameters', async () => {
  await expect(searchWarehouse1CCatalog({ kind: 'nomenclature', query: ' a ' })).resolves.toEqual([]);
  expect(client.get).not.toHaveBeenCalled();

  client.get.mockResolvedValue({ data: [{ ref: 'ref-1', code: 'A', name: 'Монитор' }] });
  const controller = new AbortController();
  await expect(searchWarehouse1CCatalog({ kind: 'warehouses', query: '  Иванов   И.И.  ', limit: 500, signal: controller.signal }))
    .resolves.toEqual([{ ref: 'ref-1', code: 'A', name: 'Монитор' }]);
  expect(client.get).toHaveBeenCalledWith('/warehouse-1c/warehouses/search', {
    params: { q: 'Иванов И.И.', limit: 50 },
    signal: controller.signal,
    timeout: 50_000,
  });
});
