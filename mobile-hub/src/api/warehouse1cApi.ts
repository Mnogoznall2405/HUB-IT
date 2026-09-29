import apiClient from './client';

const QUERY_TIMEOUT_MS = 50_000;
const EMPTY_1C_REF = '00000000-0000-0000-0000-000000000000';

type UnknownRecord = Record<string, unknown>;

export type Warehouse1CCatalogKind = 'nomenclature' | 'warehouses';

export type Warehouse1CCatalogItem = {
  ref: string;
  code: string;
  name: string;
};

export type Warehouse1CCatalogStatusValue = 'ok' | 'stale' | 'incomplete' | 'error' | 'unknown';

export type Warehouse1CCatalogStatus = {
  status: Warehouse1CCatalogStatusValue;
  nomenclature_count: number;
  warehouses_count: number;
  updated_at: string;
  age_seconds: number | null;
  stale_after_seconds: number | null;
  nomenclature_truncated: boolean;
  warehouses_truncated: boolean;
  sync_in_progress: boolean;
  complete: boolean;
  source: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function boundedString(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function count(value: unknown, max = 10_000_000): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, Math.floor(parsed))) : 0;
}

function optionalCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(31_536_000_000, Math.max(0, Math.floor(parsed))) : null;
}

function isMeaningfulRef(value: unknown): boolean {
  const ref = boundedString(value, 64).toLowerCase();
  return Boolean(ref) && ref !== EMPTY_1C_REF;
}

function normalizeStatus(value: unknown): Warehouse1CCatalogStatusValue {
  const status = boundedString(value, 32).toLowerCase();
  return ['ok', 'stale', 'incomplete', 'error', 'unknown'].includes(status)
    ? status as Warehouse1CCatalogStatusValue
    : 'unknown';
}

export function normalizeWarehouse1CCatalogItem(value: unknown): Warehouse1CCatalogItem | null {
  const source = asRecord(value);
  if (!isMeaningfulRef(source.ref)) return null;
  const name = boundedString(source.name, 500);
  if (!name) return null;
  return {
    ref: boundedString(source.ref, 64),
    code: boundedString(source.code, 200),
    name,
  };
}

export function normalizeWarehouse1CCatalogItems(payload: unknown, limit: number): Warehouse1CCatalogItem[] {
  const source = asRecord(payload);
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(source.items) ? source.items : (Array.isArray(source.results) ? source.results : []));
  const byRef = new Map<string, Warehouse1CCatalogItem>();
  for (const row of rows) {
    const item = normalizeWarehouse1CCatalogItem(row);
    if (!item) continue;
    const key = item.ref.toLowerCase();
    if (!byRef.has(key)) byRef.set(key, item);
    if (byRef.size >= limit) break;
  }
  return [...byRef.values()];
}

export function normalizeWarehouse1CCatalogStatus(payload: unknown): Warehouse1CCatalogStatus {
  const source = asRecord(payload);
  return {
    status: normalizeStatus(source.status),
    nomenclature_count: count(source.nomenclature_count),
    warehouses_count: count(source.warehouses_count),
    updated_at: boundedString(source.updated_at, 64),
    age_seconds: optionalCount(source.age_seconds),
    stale_after_seconds: optionalCount(source.stale_after_seconds),
    nomenclature_truncated: source.nomenclature_truncated === true,
    warehouses_truncated: source.warehouses_truncated === true,
    sync_in_progress: source.sync_in_progress === true,
    complete: source.complete === true,
    source: boundedString(source.source, 80),
  };
}

export type Warehouse1CListMeta = {
  status: string;
  returned: number;
  total: number | null;
  hasMore: boolean;
  truncated: boolean;
  asOf: string;
  source: string;
  incompleteReason: string;
  nextCursor: string;
  ambiguousWarehouses: number | null;
};

export type Warehouse1CListEnvelope<T> = {
  items: T[];
  meta: Warehouse1CListMeta;
};

export type Warehouse1CBalance = {
  nomenclatureRef: string;
  nomenclatureCode: string;
  nomenclatureName: string;
  characteristicName: string;
  seriesRef: string;
  seriesName: string;
  seriesNumber: string;
  warehouseRef: string;
  warehouseName: string;
  qtyBalance: number;
  costBalance: number;
  costAccountingBalance: number;
  avgPrice: number;
  batchStatusName: string;
  costMethodName: string;
  torg12Number: string;
  torg12Date: string;
  invoiceNumber: string;
  invoiceDate: string;
};

export type Warehouse1CMovement = {
  registrarRef: string;
  registrarName: string;
  registrarNumber: string;
  registrarDate: string;
  period: string;
  isTransfer: boolean;
  canOpenDetail: boolean;
  transferFromWarehouseName: string;
  transferToWarehouseName: string;
  warehouseName: string;
  qtyStart: number;
  qtyIn: number;
  qtyOut: number;
  qtyEnd: number;
  costStart: number;
  costIn: number;
  costOut: number;
  costEnd: number;
  costAccountingStart: number;
  costAccountingIn: number;
  costAccountingOut: number;
  costAccountingEnd: number;
  avgPriceStart: number;
  avgPriceEnd: number;
  torg12Number: string;
  torg12Date: string;
  invoiceNumber: string;
  invoiceDate: string;
};

export type Warehouse1CMovementFile = {
  ref: string;
  name: string;
  size: number;
  contentType: string;
};

export type Warehouse1CMovementDetail = {
  registrarRef: string;
  registrarName: string;
  registrarNumber: string;
  registrarDate: string;
  documentTitle: string;
  isTransfer: boolean;
  transferFromWarehouseName: string;
  transferToWarehouseName: string;
  warehouseName: string;
  counterpartyName: string;
  comment: string;
  files: Warehouse1CMovementFile[];
  filesStatus: string;
  filesMessage: string;
};

export type Warehouse1CDismissedEmployeeCandidate = {
  employeeName: string;
  employeeCode: string;
  city: string;
  department: string;
  position: string;
  dismissalDate: string;
};

export type Warehouse1CDismissedWarehouse = {
  warehouseRef: string;
  warehouseName: string;
  city: string;
  employeeName: string;
  employeeCandidates: Warehouse1CDismissedEmployeeCandidate[];
  positions: number;
  totalQty: number;
  totalCost: number;
  totalCostAccounting: number;
  balances: Warehouse1CBalance[];
  balancesMeta: Warehouse1CListMeta | null;
};

export type Warehouse1CMovementPreviewState = {
  status: 'queued' | 'processing' | 'ready' | 'failed';
  retryAfterMs: number;
  pdfFilename: string;
};

function optionalNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRef(value: unknown): string {
  return isMeaningfulRef(value) ? boundedString(value, 64) : '';
}

function firstDefined(source: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function metaFlag(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return Boolean(value);
}

export function normalizeWarehouse1CListMeta(payload: unknown, returned: number): Warehouse1CListMeta {
  const source = asRecord(payload);
  const envelopeMeta = asRecord(source.meta && typeof source.meta === 'object' ? source.meta : source.metadata);
  const sources = envelopeMeta && Object.keys(envelopeMeta).length ? envelopeMeta : source;
  const read = (keys: string[]) => firstDefined(sources, keys) ?? firstDefined(source, keys);
  const ambiguous = read(['ambiguous_warehouses', 'ambiguousWarehouses']);
  const total = read(['total']);
  return {
    status: boundedString(read(['status']), 40),
    returned: Math.max(0, Math.trunc(optionalNumber(read(['returned'])) || returned)),
    total: total === null || total === undefined ? null : Math.max(0, Math.trunc(optionalNumber(total))),
    hasMore: metaFlag(read(['has_more', 'hasMore'])),
    truncated: metaFlag(read(['truncated'])),
    asOf: boundedString(read(['as_of', 'asOf']), 64),
    source: boundedString(read(['source']), 80),
    incompleteReason: boundedString(read(['incomplete_reason', 'incompleteReason']), 200),
    nextCursor: boundedString(read(['next_cursor', 'nextCursor']), 512),
    ambiguousWarehouses: ambiguous === undefined || ambiguous === null ? null : Math.max(0, Math.trunc(optionalNumber(ambiguous))),
  };
}

function listPayloadRows(payload: unknown): { rows: unknown[]; metaSource: unknown } {
  const source = asRecord(payload);
  if (Array.isArray(payload)) return { rows: payload, metaSource: {} };
  if (Array.isArray(source.items)) return { rows: source.items, metaSource: payload };
  if (Array.isArray(source.rows)) return { rows: source.rows, metaSource: payload };
  return { rows: [], metaSource: payload };
}

export function isWarehouse1CListIncomplete(meta: Warehouse1CListMeta | null | undefined): boolean {
  if (!meta) return false;
  const status = meta.status.trim().toLowerCase();
  return Boolean(
    meta.truncated
    || meta.hasMore
    || status === 'incomplete'
    || status === 'unknown'
    || status === 'error',
  );
}

export function normalizeWarehouse1CBalance(value: unknown): Warehouse1CBalance | null {
  const source = asRecord(value);
  const nomenclatureName = boundedString(source.nomenclature_name, 500);
  const warehouseName = boundedString(source.warehouse_name, 500);
  if (!nomenclatureName && !warehouseName) return null;
  return {
    nomenclatureRef: normalizeRef(source.nomenclature_ref),
    nomenclatureCode: boundedString(source.nomenclature_code, 200),
    nomenclatureName,
    characteristicName: boundedString(source.characteristic_name, 300),
    seriesRef: normalizeRef(source.series_ref),
    seriesName: boundedString(source.series_name, 300),
    seriesNumber: boundedString(source.series_number, 200),
    warehouseRef: normalizeRef(source.warehouse_ref),
    warehouseName,
    qtyBalance: optionalNumber(source.qty_balance),
    costBalance: optionalNumber(source.cost_balance),
    costAccountingBalance: optionalNumber(source.cost_accounting_balance),
    avgPrice: optionalNumber(source.avg_price),
    batchStatusName: boundedString(source.batch_status_name, 200),
    costMethodName: boundedString(source.cost_method_name, 200),
    torg12Number: boundedString(source.torg12_number, 100),
    torg12Date: boundedString(source.torg12_date, 40),
    invoiceNumber: boundedString(source.invoice_number, 100),
    invoiceDate: boundedString(source.invoice_date, 40),
  };
}

export function normalizeWarehouse1CMovement(value: unknown): Warehouse1CMovement | null {
  const source = asRecord(value);
  const registrarRef = boundedString(source.registrar_ref, 64);
  const registrarName = boundedString(source.registrar_name, 500);
  if (!registrarRef && !registrarName) return null;
  const canOpen = source.can_open_detail === undefined
    ? isMeaningfulRef(registrarRef)
    : source.can_open_detail === true;
  return {
    registrarRef,
    registrarName,
    registrarNumber: boundedString(source.registrar_number, 100),
    registrarDate: boundedString(source.registrar_date, 40),
    period: boundedString(source.period, 40),
    isTransfer: source.is_transfer === true,
    canOpenDetail: canOpen,
    transferFromWarehouseName: boundedString(source.transfer_from_warehouse_name, 500),
    transferToWarehouseName: boundedString(source.transfer_to_warehouse_name, 500),
    warehouseName: boundedString(source.warehouse_name, 500),
    qtyStart: optionalNumber(source.qty_start),
    qtyIn: optionalNumber(source.qty_in),
    qtyOut: optionalNumber(source.qty_out),
    qtyEnd: optionalNumber(source.qty_end),
    costStart: optionalNumber(source.cost_start),
    costIn: optionalNumber(source.cost_in),
    costOut: optionalNumber(source.cost_out),
    costEnd: optionalNumber(source.cost_end),
    costAccountingStart: optionalNumber(source.cost_accounting_start),
    costAccountingIn: optionalNumber(source.cost_accounting_in),
    costAccountingOut: optionalNumber(source.cost_accounting_out),
    costAccountingEnd: optionalNumber(source.cost_accounting_end),
    avgPriceStart: optionalNumber(source.avg_price_start),
    avgPriceEnd: optionalNumber(source.avg_price_end),
    torg12Number: boundedString(source.torg12_number, 100),
    torg12Date: boundedString(source.torg12_date, 40),
    invoiceNumber: boundedString(source.invoice_number, 100),
    invoiceDate: boundedString(source.invoice_date, 40),
  };
}

export function normalizeWarehouse1CMovementDetail(payload: unknown): Warehouse1CMovementDetail {
  const source = asRecord(payload);
  const files = (Array.isArray(source.files) ? source.files : [])
    .map((row): Warehouse1CMovementFile | null => {
      const file = asRecord(row);
      const name = boundedString(file.name, 500);
      if (!name) return null;
      return {
        ref: boundedString(file.ref, 64),
        name,
        size: Math.max(0, optionalNumber(file.size)),
        contentType: boundedString(file.content_type, 200),
      };
    })
    .filter((file): file is Warehouse1CMovementFile => file !== null);
  return {
    registrarRef: boundedString(source.registrar_ref, 64),
    registrarName: boundedString(source.registrar_name, 500),
    registrarNumber: boundedString(source.registrar_number, 100),
    registrarDate: boundedString(source.registrar_date, 40),
    documentTitle: boundedString(source.document_title, 300),
    isTransfer: source.is_transfer === true,
    transferFromWarehouseName: boundedString(source.transfer_from_warehouse_name, 500),
    transferToWarehouseName: boundedString(source.transfer_to_warehouse_name, 500),
    warehouseName: boundedString(source.warehouse_name, 500),
    counterpartyName: boundedString(source.counterparty_name, 500),
    comment: boundedString(source.comment, 2000),
    files,
    filesStatus: boundedString(source.files_status, 40) || 'pending',
    filesMessage: boundedString(source.files_message, 500),
  };
}

export function normalizeWarehouse1CDismissedWarehouse(value: unknown): Warehouse1CDismissedWarehouse | null {
  const source = asRecord(value);
  const warehouse = asRecord(source.warehouse);
  const warehouseName = boundedString(warehouse.name, 500) || boundedString(source.warehouse_name, 500);
  if (!warehouseName) return null;
  const totals = asRecord(source.totals);
  const candidates = (Array.isArray(source.employee_candidates) ? source.employee_candidates : [])
    .map((row): Warehouse1CDismissedEmployeeCandidate | null => {
      const candidate = asRecord(row);
      const employeeName = boundedString(candidate.employee_name ?? candidate.name, 300);
      if (!employeeName) return null;
      return {
        employeeName,
        employeeCode: boundedString(candidate.employee_code, 100),
        city: boundedString(candidate.city, 200),
        department: boundedString(candidate.department, 300),
        position: boundedString(candidate.position, 300),
        dismissalDate: boundedString(candidate.dismissal_date, 40),
      };
    })
    .filter((candidate): candidate is Warehouse1CDismissedEmployeeCandidate => candidate !== null);
  const balances = (Array.isArray(source.balances) ? source.balances : [])
    .map(normalizeWarehouse1CBalance)
    .filter((row): row is Warehouse1CBalance => row !== null);
  const balancesMetaSource = source.balances_meta === undefined ? undefined : source.balances_meta;
  return {
    warehouseRef: normalizeRef(warehouse.ref ?? source.warehouse_ref),
    warehouseName,
    city: boundedString(source.city, 200),
    employeeName: boundedString(source.employee_name, 300),
    employeeCandidates: candidates,
    positions: Math.max(0, Math.trunc(optionalNumber(totals.positions))),
    totalQty: optionalNumber(totals.qty),
    totalCost: optionalNumber(totals.cost),
    totalCostAccounting: optionalNumber(totals.cost_accounting),
    balances,
    balancesMeta: balancesMetaSource === undefined ? null : normalizeWarehouse1CListMeta(balancesMetaSource, balances.length),
  };
}

export async function getWarehouse1CBalances(options: {
  nomenclatureRef?: string;
  warehouseRef?: string;
  query?: string;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<Warehouse1CListEnvelope<Warehouse1CBalance>> {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 200)));
  const response = await apiClient.get('/warehouse-1c/balances', {
    params: {
      nomenclature_ref: normalizeRef(options.nomenclatureRef),
      warehouse_ref: normalizeRef(options.warehouseRef),
      q: boundedString(options.query, 200).replace(/\s+/g, ' '),
      limit,
      include_meta: true,
    },
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  const { rows, metaSource } = listPayloadRows(response.data);
  const items = rows
    .map(normalizeWarehouse1CBalance)
    .filter((row): row is Warehouse1CBalance => row !== null);
  return { items, meta: normalizeWarehouse1CListMeta(metaSource, items.length) };
}

export async function getWarehouse1CMovements(options: {
  nomenclatureRef: string;
  warehouseRef?: string;
  seriesRef?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<Warehouse1CListEnvelope<Warehouse1CMovement>> {
  const nomenclatureRef = normalizeRef(options.nomenclatureRef);
  if (!nomenclatureRef) throw new Error('Выберите номенклатуру для ведомости движений');
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 100)));
  const cursor = boundedString(options.cursor, 512);
  const response = await apiClient.get('/warehouse-1c/movements', {
    params: {
      nomenclature_ref: nomenclatureRef,
      warehouse_ref: normalizeRef(options.warehouseRef),
      series_ref: normalizeRef(options.seriesRef),
      date_from: boundedString(options.dateFrom, 40),
      date_to: boundedString(options.dateTo, 40),
      limit,
      ...(cursor ? { cursor } : {}),
      include_meta: true,
    },
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  const { rows, metaSource } = listPayloadRows(response.data);
  const items = rows
    .map(normalizeWarehouse1CMovement)
    .filter((row): row is Warehouse1CMovement => row !== null);
  return { items, meta: normalizeWarehouse1CListMeta(metaSource, items.length) };
}

export async function getWarehouse1CMovementDetail(
  registrarRef: string,
  options: { signal?: AbortSignal } = {},
): Promise<Warehouse1CMovementDetail> {
  const ref = normalizeRef(registrarRef);
  if (!ref) throw new Error('Не выбран документ движения 1С');
  const response = await apiClient.get('/warehouse-1c/movements/detail', {
    params: { registrar_ref: ref },
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  return normalizeWarehouse1CMovementDetail(response.data);
}

export async function getWarehouse1CDismissedWarehouses(options: {
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<Warehouse1CListEnvelope<Warehouse1CDismissedWarehouse>> {
  const limit = Math.max(1, Math.min(5000, Math.floor(Number(options.limit) || 1000)));
  const response = await apiClient.get('/warehouse-1c/dismissed-warehouses', {
    params: { limit },
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  const { rows, metaSource } = listPayloadRows(response.data);
  const items = rows
    .map(normalizeWarehouse1CDismissedWarehouse)
    .filter((row): row is Warehouse1CDismissedWarehouse => row !== null);
  return { items, meta: normalizeWarehouse1CListMeta(metaSource, items.length) };
}

export async function getWarehouse1CMovementFilePreviewState(
  registrarRef: string,
  fileRef: string,
  signal?: AbortSignal,
): Promise<Warehouse1CMovementPreviewState> {
  const safeRegistrarRef = normalizeRef(registrarRef);
  const safeFileRef = boundedString(fileRef, 64);
  if (!safeRegistrarRef || !safeFileRef) throw new Error('Не выбран файл документа 1С');
  const response = await apiClient.get(
    `/warehouse-1c/movements/files/${encodeURIComponent(safeFileRef)}/preview`,
    {
      params: { registrar_ref: safeRegistrarRef },
      signal,
      timeout: QUERY_TIMEOUT_MS,
      validateStatus: (status) => (status >= 200 && status < 300) || status === 422,
    },
  );
  const row = asRecord(response.data);
  const rawStatus = boundedString(row.status, 32).toLowerCase();
  const status: Warehouse1CMovementPreviewState['status'] = (
    rawStatus === 'processing' || rawStatus === 'ready' || rawStatus === 'failed'
      ? rawStatus
      : 'queued'
  );
  return {
    status,
    retryAfterMs: Math.min(5_000, Math.max(100, Math.trunc(optionalNumber(row.retry_after_ms) || 500))),
    pdfFilename: boundedString(row.pdf_filename, 512),
  };
}

export async function getWarehouse1CCatalogStatus(options: { signal?: AbortSignal } = {}): Promise<Warehouse1CCatalogStatus> {
  const response = await apiClient.get('/warehouse-1c/catalog/status', {
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  return normalizeWarehouse1CCatalogStatus(response.data);
}

export async function searchWarehouse1CCatalog(options: {
  kind: Warehouse1CCatalogKind;
  query: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<Warehouse1CCatalogItem[]> {
  const query = boundedString(options.query, 200).replace(/\s+/g, ' ');
  if (query.length < 2) return [];
  const limit = Math.max(1, Math.min(50, Math.floor(Number(options.limit) || 30)));
  const endpoint = options.kind === 'warehouses'
    ? '/warehouse-1c/warehouses/search'
    : '/warehouse-1c/nomenclature/search';
  const response = await apiClient.get(endpoint, {
    params: { q: query, limit },
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  return normalizeWarehouse1CCatalogItems(response.data, limit);
}

export type Warehouse1CEmployeeWarehouseStatus = 'matched' | 'ambiguous' | 'not_found' | 'unknown';

export type Warehouse1CEmployeeWarehouse = {
  status: Warehouse1CEmployeeWarehouseStatus;
  warehouse: Warehouse1CCatalogItem | null;
  candidates: Warehouse1CCatalogItem[];
  balances: Warehouse1CBalance[];
  balancesMeta: Warehouse1CListMeta | null;
  employmentStatus: string;
  employmentLabel: string;
};

function normalizeEmployeeWarehouseStatus(value: unknown): Warehouse1CEmployeeWarehouseStatus {
  const status = boundedString(value, 24).toLowerCase();
  if (status === 'matched' || status === 'ambiguous' || status === 'not_found') return status;
  return 'unknown';
}

export function normalizeWarehouse1CEmployeeWarehouse(payload: unknown): Warehouse1CEmployeeWarehouse {
  const row = asRecord(payload);
  const candidates = (Array.isArray(row.candidates) ? row.candidates : [])
    .map(normalizeWarehouse1CCatalogItem)
    .filter((item): item is Warehouse1CCatalogItem => item !== null)
    .slice(0, 50);
  const balances = (Array.isArray(row.balances) ? row.balances : [])
    .map(normalizeWarehouse1CBalance)
    .filter((item): item is Warehouse1CBalance => item !== null);
  const metaSource = row.balances_meta !== undefined ? row.balances_meta : null;
  return {
    status: normalizeEmployeeWarehouseStatus(row.status),
    warehouse: normalizeWarehouse1CCatalogItem(row.warehouse),
    candidates,
    balances,
    balancesMeta: metaSource === null ? null : normalizeWarehouse1CListMeta(metaSource, balances.length),
    employmentStatus: boundedString(row.employment_status, 40),
    employmentLabel: boundedString(row.employment_label, 200),
  };
}

export async function getWarehouse1CEmployeeWarehouse(options: {
  employeeName?: string;
  warehouseRef?: string;
  loadBalances?: boolean;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<Warehouse1CEmployeeWarehouse> {
  const employeeName = boundedString(options.employeeName, 200).replace(/\s+/g, ' ').trim();
  const warehouseRef = normalizeRef(options.warehouseRef);
  if (!employeeName && !warehouseRef) throw new Error('Не указан сотрудник или склад 1С.');
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 200)));
  const response = await apiClient.get('/warehouse-1c/employee-warehouse', {
    params: {
      employee_name: employeeName,
      warehouse_ref: warehouseRef,
      load_balances: options.loadBalances !== false,
      limit,
    },
    signal: options.signal,
    timeout: QUERY_TIMEOUT_MS,
  });
  return normalizeWarehouse1CEmployeeWarehouse(response.data);
}
