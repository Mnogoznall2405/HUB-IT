import apiClient from './client';

export const WAREHOUSE_1C_QUERY_TIMEOUT_MS = 50_000;
export const EMPTY_1C_REF = '00000000-0000-0000-0000-000000000000';

export const isMeaningful1cRef = (value) => {
  const text = String(value || '').trim().toLowerCase();
  return Boolean(text) && text !== EMPTY_1C_REF;
};

export const normalize1cRef = (value) => (
  isMeaningful1cRef(value) ? String(value || '').trim() : ''
);

const readFirstDefined = (sources, keys) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }
  }
  return undefined;
};

const toOptionalCount = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const toOptionalBoolean = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return Boolean(value);
};

/**
 * Keeps existing array responses working while accepting the metadata envelope
 * introduced by the hardened warehouse endpoints: `{ items, meta }`.
 */
export const normalizeWarehouse1cListResponse = (payload) => {
  if (Array.isArray(payload)) {
    return { items: payload, meta: { returned: payload.length } };
  }

  const body = payload && typeof payload === 'object' ? payload : {};
  const envelopeMeta = body.meta && typeof body.meta === 'object'
    ? body.meta
    : (body.metadata && typeof body.metadata === 'object' ? body.metadata : {});
  const items = Array.isArray(body.items)
    ? body.items
    : (Array.isArray(body.rows) ? body.rows : []);
  const sources = [envelopeMeta, body];

  return {
    items,
    meta: {
      status: readFirstDefined(sources, ['status']),
      returned: toOptionalCount(readFirstDefined(sources, ['returned'])) ?? items.length,
      total: toOptionalCount(readFirstDefined(sources, ['total'])),
      hasMore: toOptionalBoolean(readFirstDefined(sources, ['has_more', 'hasMore'])),
      truncated: toOptionalBoolean(readFirstDefined(sources, ['truncated'])),
      asOf: readFirstDefined(sources, ['as_of', 'asOf']),
      source: readFirstDefined(sources, ['source']),
    },
  };
};

export const isWarehouse1cListIncomplete = (meta = {}) => {
  const status = String(meta?.status || '').trim().toLowerCase();
  return Boolean(
    meta?.truncated
    || meta?.hasMore
    || status === 'incomplete'
    || status === 'unknown'
    || status === 'error',
  );
};

export const warehouse1cAPI = {
  searchNomenclature: async (q, limit = 50) => {
    const { data } = await apiClient.get('/warehouse-1c/nomenclature/search', {
      params: { q, limit },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  // Склады directory is small but has many near-duplicate names (one
  // warehouse per employee/location sharing a city/project substring), so a
  // higher page than nomenclature reduces the chance the wanted item is cut
  // off by the autocomplete cap.
  searchWarehouses: async (q, limit = 50) => {
    const { data } = await apiClient.get('/warehouse-1c/warehouses/search', {
      params: { q, limit },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getBalances: async ({
    nomenclatureRef = '',
    warehouseRef = '',
    q = '',
    limit = 200,
    includeMeta = true,
  } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/balances', {
      params: {
        nomenclature_ref: normalize1cRef(nomenclatureRef),
        warehouse_ref: normalize1cRef(warehouseRef),
        q,
        limit,
        include_meta: includeMeta,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  /**
   * Read balances for a bounded set of nomenclature references in one 1C
   * operation.  The bridge returns an envelope, including completeness
   * metadata, so callers must not treat an incomplete result as zero stock.
   */
  getBalancesBatch: async ({
    nomenclatureRefs = [],
    warehouseRef = '',
    limitPerNomenclature = 50,
  } = {}) => {
    const refs = Array.from(new Set(
      (Array.isArray(nomenclatureRefs) ? nomenclatureRefs : [])
        .map(normalize1cRef)
        .filter(Boolean),
    ));
    if (refs.length > 50) {
      throw new RangeError('За один batch-запрос остатков 1С можно передать не более 50 номенклатур.');
    }
    const { data } = await apiClient.post('/warehouse-1c/balances/batch', {
      nomenclature_refs: refs,
      warehouse_ref: normalize1cRef(warehouseRef),
      limit_per_nomenclature: limitPerNomenclature,
    }, {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getBalancesWithHub: async ({
    nomenclatureRef = '',
    partNo = '',
    nomenclatureCode = '',
    modelName = '',
    hubQuery = '',
    hubQuerySource = 'model',
    limit = 200,
  } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/balances-with-hub', {
      params: {
        nomenclature_ref: normalize1cRef(nomenclatureRef),
        part_no: partNo,
        nomenclature_code: nomenclatureCode,
        model_name: modelName,
        hub_query: hubQuery,
        hub_query_source: hubQuerySource,
        limit,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getMovements: async ({
    nomenclatureRef,
    warehouseRef = '',
    seriesRef = '',
    dateFrom = '',
    dateTo = '',
    limit = 500,
    cursor = '',
    includeMeta = true,
  } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/movements', {
      params: {
        nomenclature_ref: normalize1cRef(nomenclatureRef),
        warehouse_ref: normalize1cRef(warehouseRef),
        series_ref: normalize1cRef(seriesRef),
        date_from: dateFrom,
        date_to: dateTo,
        limit,
        ...(cursor ? { cursor } : {}),
        include_meta: includeMeta,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getCatalogStatus: async () => {
    const { data } = await apiClient.get('/warehouse-1c/catalog/status', {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getRuntimeStatus: async () => {
    const { data } = await apiClient.get('/warehouse-1c/status', {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  syncCatalog: async () => {
    const { data } = await apiClient.post('/warehouse-1c/catalog/sync', undefined, {
      timeout: 610_000,
    });
    return data;
  },

  getMovementDetail: async (registrarRef) => {
    const { data } = await apiClient.get('/warehouse-1c/movements/detail', {
      params: { registrar_ref: normalize1cRef(registrarRef) },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  downloadMovementFile: async (registrarRef, fileRef) => {
    const response = await apiClient.get(`/warehouse-1c/movements/files/${encodeURIComponent(normalize1cRef(fileRef))}`, {
      params: { registrar_ref: normalize1cRef(registrarRef) },
      responseType: 'blob',
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return response;
  },

  getEmployeeWarehouse: async ({ employeeName = '', warehouseRef = '', loadBalances = true, limit = 200 } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/employee-warehouse', {
      params: {
        employee_name: employeeName,
        warehouse_ref: normalize1cRef(warehouseRef),
        load_balances: loadBalances,
        limit,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  matchNomenclatureToHub: async ({
    nomenclatureCode = '',
    nomenclatureName = '',
    nomenclatureRef = '',
    ownerNo = null,
    warehouseName = '',
    employeeName = '',
    qtyBalance = null,
    limit = 50,
  } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/nomenclature/match-to-hub', {
      params: {
        nomenclature_code: nomenclatureCode,
        nomenclature_name: nomenclatureName,
        nomenclature_ref: normalize1cRef(nomenclatureRef),
        owner_no: ownerNo || undefined,
        warehouse_name: warehouseName || undefined,
        employee_name: employeeName || undefined,
        qty_balance: qtyBalance == null || qtyBalance === '' ? undefined : qtyBalance,
        limit,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  suggestNomenclature: async (text, limit = 20) => {
    const { data } = await apiClient.get('/warehouse-1c/nomenclature/suggest', {
      params: { text, limit },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getReconcileCoverage: async () => {
    const { data } = await apiClient.get('/warehouse-1c/reconcile/coverage', {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getReconcileQueue: async ({
    queue = 'pending',
    q = '',
    hasOwner = 'with',
    limit = 100,
    offset = 0,
  } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/reconcile/queue', {
      params: { queue, q, has_owner: hasOwner, limit, offset },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getReconcileItemSuggestions: async ({
    invNo = '',
    modelName = '',
    serialNo = '',
    employeeName = '',
    ownerNo = null,
    limit = 8,
  } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/reconcile/item-suggestions', {
      params: {
        inv_no: invNo,
        model_name: modelName,
        serial_no: serialNo,
        employee_name: employeeName || undefined,
        owner_no: ownerNo || undefined,
        limit,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getReconcileOwnerMismatches: async ({
    employeeName = '',
    warehouseRef = '',
    limit = 100,
  } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/reconcile/owner-mismatches', {
      params: {
        employee_name: employeeName,
        warehouse_ref: normalize1cRef(warehouseRef),
        limit,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getReconcileHubOver1c: async ({ limit = 50, cursor = '' } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/reconcile/hub-over-1c', {
      params: { limit, ...(cursor ? { cursor } : {}) },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  applyReconcilePartNo: async ({
    invNo,
    nomenclatureRef = '',
    partNo,
    reason = '',
    expectedPartNo = undefined,
    expectedVersion = 0,
    confirm = false,
  } = {}) => {
    const body = {
      inv_no: invNo,
      nomenclature_ref: normalize1cRef(nomenclatureRef),
      part_no: partNo,
      reason,
      expected_part_no: expectedPartNo ?? '',
      confirm,
      expected_version: expectedVersion ?? 0,
    };
    const { data } = await apiClient.post('/warehouse-1c/reconcile/apply-part-no', body, {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  markReconcileNotIn1c: async ({
    invNo,
    reason = '',
    expectedPartNo = undefined,
    expectedVersion = 0,
    confirm = false,
  } = {}) => {
    const body = {
      inv_no: invNo,
      reason,
      expected_part_no: expectedPartNo ?? '',
      confirm,
      expected_version: expectedVersion ?? 0,
    };
    const { data } = await apiClient.post('/warehouse-1c/reconcile/mark-not-in-1c', body, {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  autoLinkReconcile: async ({
    limit = 50,
    dryRun = true,
  } = {}) => {
    if (!dryRun) {
      throw new Error('Автоподбор 1С доступен только как предпросмотр; подтвердите связь по одной позиции.');
    }
    const { data } = await apiClient.post('/warehouse-1c/reconcile/auto-link', {
      limit,
      dry_run: true,
    }, {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  aiSuggestReconcile: async ({
    invNo = '',
    modelName = '',
    serialNo = '',
    limit = 3,
  } = {}) => {
    const { data } = await apiClient.post('/warehouse-1c/reconcile/ai-suggest', {
      inv_no: invNo,
      model_name: modelName,
      serial_no: serialNo,
      limit,
    }, {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },
};

export default warehouse1cAPI;
