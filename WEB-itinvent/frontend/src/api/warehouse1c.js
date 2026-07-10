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

export const warehouse1cAPI = {
  searchNomenclature: async (q, limit = 20) => {
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

  getBalances: async ({ nomenclatureRef = '', warehouseRef = '', q = '', limit = 200 } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/balances', {
      params: {
        nomenclature_ref: normalize1cRef(nomenclatureRef),
        warehouse_ref: normalize1cRef(warehouseRef),
        q,
        limit,
      },
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
  } = {}) => {
    const { data } = await apiClient.get('/warehouse-1c/movements', {
      params: {
        nomenclature_ref: normalize1cRef(nomenclatureRef),
        warehouse_ref: normalize1cRef(warehouseRef),
        series_ref: normalize1cRef(seriesRef),
        date_from: dateFrom,
        date_to: dateTo,
        limit,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
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

  suggestNomenclature: async (text, limit = 20) => {
    const { data } = await apiClient.get('/warehouse-1c/nomenclature/suggest', {
      params: { text, limit },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },
};

export default warehouse1cAPI;
