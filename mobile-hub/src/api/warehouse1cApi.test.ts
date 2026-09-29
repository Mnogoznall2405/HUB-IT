import apiClient from './client';
import {
  getWarehouse1CBalances,
  getWarehouse1CCatalogStatus,
  getWarehouse1CDismissedWarehouses,
  getWarehouse1CEmployeeWarehouse,
  getWarehouse1CMovementDetail,
  getWarehouse1CMovementFilePreviewState,
  getWarehouse1CMovements,
  isWarehouse1CListIncomplete,
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

it('normalizes the balances envelope and drops rows without names', async () => {
  client.get.mockResolvedValue({ data: {
    items: [
      {
        nomenclature_ref: 'nom-1', nomenclature_code: 'M-1', nomenclature_name: 'Монитор',
        series_ref: 'ser-1', series_name: 'S/N', warehouse_ref: 'wh-1', warehouse_name: 'Склад Иванов',
        qty_balance: '2.5', cost_balance: '1000.55', cost_accounting_balance: 900,
        avg_price: 400.22, batch_status_name: 'Хорошая', cost_method_name: 'FIFO',
        torg12_number: '12', torg12_date: '2026-01-10', invoice_number: 'SF-9', invoice_date: '2026-01-11',
      },
      { nomenclature_ref: 'nom-2' },
      'garbage',
    ],
    meta: { status: 'incomplete', returned: '1', has_more: true, as_of: '2026-09-01T00:00:00Z', source: 'live_1c' },
  } });
  const controller = new AbortController();
  const result = await getWarehouse1CBalances({
    nomenclatureRef: ' nom-1 ', warehouseRef: '00000000-0000-0000-0000-000000000000',
    query: '  мон   итор ', limit: 9999, signal: controller.signal,
  });
  expect(client.get).toHaveBeenCalledWith('/warehouse-1c/balances', expect.objectContaining({
    params: {
      nomenclature_ref: 'nom-1', warehouse_ref: '', q: 'мон итор', limit: 500, include_meta: true,
    },
    signal: controller.signal,
    timeout: 50_000,
  }));
  expect(result.items).toEqual([expect.objectContaining({
    nomenclatureRef: 'nom-1', nomenclatureName: 'Монитор', warehouseName: 'Склад Иванов',
    qtyBalance: 2.5, costBalance: 1000.55, costAccountingBalance: 900, avgPrice: 400.22,
  })]);
  expect(result.meta.status).toBe('incomplete');
  expect(result.meta.hasMore).toBe(true);
  expect(isWarehouse1CListIncomplete(result.meta)).toBe(true);
});

it('requires a nomenclature ref for movements and follows the cursor', async () => {
  await expect(getWarehouse1CMovements({ nomenclatureRef: '  ' })).rejects.toThrow('номенклатуру');
  expect(client.get).not.toHaveBeenCalled();

  client.get.mockResolvedValue({ data: {
    items: [{
      registrar_ref: 'reg-1', registrar_name: 'Перемещение', registrar_number: '77',
      period: '2026-09-01T00:00:00Z', is_transfer: true,
      transfer_from_warehouse_name: 'А', transfer_to_warehouse_name: 'Б',
      qty_in: '3', qty_out: '1', qty_end: '5', can_open_detail: true,
    }],
    next_cursor: 'cursor-2', has_more: true, truncated: true, status: 'incomplete',
  } });
  const result = await getWarehouse1CMovements({
    nomenclatureRef: 'nom-1', warehouseRef: 'wh-1', dateFrom: '2026-01-01', dateTo: '2026-09-01',
    limit: 1000, cursor: 'cursor-1',
  });
  expect(client.get).toHaveBeenCalledWith('/warehouse-1c/movements', expect.objectContaining({
    params: expect.objectContaining({
      nomenclature_ref: 'nom-1', warehouse_ref: 'wh-1', date_from: '2026-01-01', date_to: '2026-09-01',
      limit: 500, cursor: 'cursor-1', include_meta: true,
    }),
  }));
  expect(result.items).toEqual([expect.objectContaining({
    registrarRef: 'reg-1', registrarNumber: '77', isTransfer: true,
    qtyIn: 3, qtyOut: 1, qtyEnd: 5, canOpenDetail: true,
  })]);
  expect(result.meta.nextCursor).toBe('cursor-2');
});

it('normalizes movement detail with bounded files', async () => {
  client.get.mockResolvedValue({ data: {
    registrar_ref: 'reg-1', registrar_name: 'Поступление', registrar_number: '5',
    registrar_date: '2026-09-02T10:00:00Z', document_title: 'Поступление товаров',
    warehouse_name: 'Основной', counterparty_name: 'Поставщик', comment: 'ok',
    files: [
      { ref: 'f-1', name: 'накладная.pdf', size: '1024', content_type: 'application/pdf' },
      { ref: 'f-2', name: '' },
    ],
    files_status: 'ok', files_message: '', secret_payload: 'hidden',
  } });
  const detail = await getWarehouse1CMovementDetail(' reg-1 ');
  expect(client.get).toHaveBeenCalledWith('/warehouse-1c/movements/detail', expect.objectContaining({
    params: { registrar_ref: 'reg-1' },
  }));
  expect(detail.files).toEqual([
    { ref: 'f-1', name: 'накладная.pdf', size: 1024, contentType: 'application/pdf' },
  ]);
  expect(detail).not.toHaveProperty('secret_payload');
  await expect(getWarehouse1CMovementDetail(' ')).rejects.toThrow('документ');
});

it('normalizes dismissed warehouses with totals and nested balances', async () => {
  client.get.mockResolvedValue({ data: {
    items: [{
      warehouse: { ref: 'wh-1', name: 'Склад Петров' },
      city: 'Москва', employee_name: 'Петров И.И.',
      employee_candidates: [{ employee_name: 'Петров И.И.', city: 'Москва', dismissal_date: '2026-08-01' }],
      totals: { positions: '2', qty: '3.5', cost: '100', cost_accounting: '90' },
      balances: [{ nomenclature_name: 'Мышь', qty_balance: 2, cost_balance: 50 }],
      balances_meta: { truncated: true },
    }],
    truncated: true, has_more: false, status: 'incomplete',
  } });
  const result = await getWarehouse1CDismissedWarehouses({ limit: 99999 });
  expect(client.get).toHaveBeenCalledWith('/warehouse-1c/dismissed-warehouses', expect.objectContaining({
    params: { limit: 5000 },
  }));
  expect(result.items).toHaveLength(1);
  const row = result.items[0];
  expect(row.warehouseName).toBe('Склад Петров');
  expect(row.positions).toBe(2);
  expect(row.totalQty).toBe(3.5);
  expect(row.balances).toEqual([expect.objectContaining({ nomenclatureName: 'Мышь', qtyBalance: 2 })]);
  expect(row.balancesMeta?.truncated).toBe(true);
});

it('maps the preview state endpoint including the 422 failure body', async () => {
  client.get.mockResolvedValue({ data: { status: 'processing', retry_after_ms: '250' } });
  await expect(getWarehouse1CMovementFilePreviewState('reg-1', 'f-1')).resolves.toEqual({
    status: 'processing', retryAfterMs: 250, pdfFilename: '',
  });
  expect(client.get).toHaveBeenCalledWith(
    '/warehouse-1c/movements/files/f-1/preview',
    expect.objectContaining({ params: { registrar_ref: 'reg-1' } }),
  );

  client.get.mockResolvedValue({ data: { status: 'failed', retry_after_ms: 500, pdf_filename: 'doc.pdf' } });
  await expect(getWarehouse1CMovementFilePreviewState('reg-1', 'f-1')).resolves.toEqual({
    status: 'failed', retryAfterMs: 500, pdfFilename: 'doc.pdf',
  });
});

it('normalizes the employee warehouse response with candidates and balances meta', async () => {
  client.get.mockResolvedValue({ data: {
    status: 'matched',
    warehouse: { ref: 'wh-1', name: 'Склад Иванов И.И.' },
    candidates: [],
    balances: [
      { nomenclature_ref: 'n-1', nomenclature_code: 'PN-1', nomenclature_name: 'Монитор', qty_balance: '2' },
    ],
    balances_meta: { status: 'ok', total: '1', has_more: 'false' },
    employment_status: 'active',
    employment_label: '',
  } });
  const result = await getWarehouse1CEmployeeWarehouse({ employeeName: '  Иванов   И.И. ' });
  expect(result.status).toBe('matched');
  expect(result.warehouse).toEqual({ ref: 'wh-1', code: '', name: 'Склад Иванов И.И.' });
  expect(result.balances).toHaveLength(1);
  expect(result.balances[0].qtyBalance).toBe(2);
  expect(result.balancesMeta?.total).toBe(1);
  expect(client.get).toHaveBeenCalledWith('/warehouse-1c/employee-warehouse', expect.objectContaining({
    params: { employee_name: 'Иванов И.И.', warehouse_ref: '', load_balances: true, limit: 200 },
  }));
});

it('keeps ambiguous candidate lists for the picker', async () => {
  client.get.mockResolvedValue({ data: {
    status: 'ambiguous',
    warehouse: null,
    candidates: [{ ref: 'wh-1', name: 'Склад А' }, { ref: 'wh-2', name: 'Склад Б' }],
    balances: [],
  } });
  const result = await getWarehouse1CEmployeeWarehouse({ employeeName: 'Петров' });
  expect(result.status).toBe('ambiguous');
  expect(result.candidates.map((item) => item.ref)).toEqual(['wh-1', 'wh-2']);
  expect(result.balancesMeta).toBeNull();
});
