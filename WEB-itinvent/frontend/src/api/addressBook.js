import apiClient from './client';

export const ADDRESS_BOOK_SYNC_TIMEOUT_MS = 120_000;

const normalizeFilterValue = (value) => String(value || '').trim();

export const addressBookAPI = {
  search: async ({
    q = '',
    limit = 50,
    offset = 0,
    dismissed = false,
    department = '',
    city = '',
    employeeCodes = [],
  } = {}) => {
    const normalizedDepartment = normalizeFilterValue(department);
    const normalizedCity = normalizeFilterValue(city);
    const normalizedCodes = (Array.isArray(employeeCodes) ? employeeCodes : [])
      .map(normalizeFilterValue)
      .filter(Boolean)
      .slice(0, 50);
    const { data } = await apiClient.get('/address-book/search', {
      params: {
        q,
        limit,
        // Backend defaults to offset=0; send it only when loading the next page.
        ...(offset > 0 ? { offset } : {}),
        dismissed,
        // Optional C2 filters: only sent when set, older calls stay byte-identical.
        ...(normalizedDepartment ? { department: normalizedDepartment } : {}),
        ...(normalizedCity ? { city: normalizedCity } : {}),
        ...(normalizedCodes.length ? { employee_codes: normalizedCodes } : {}),
      },
      // FastAPI reads repeated keys (employee_codes=A&employee_codes=B), not axios's default a[]=1 form.
      paramsSerializer: { indexes: null },
    });
    return data;
  },
  getFilters: async ({ dismissed = false } = {}) => {
    const { data } = await apiClient.get('/address-book/filters', {
      params: { dismissed },
    });
    return data;
  },
  getStatus: async () => {
    const { data } = await apiClient.get('/address-book/status');
    return data;
  },
  sync: async () => {
    const { data } = await apiClient.post('/address-book/sync', null, {
      timeout: ADDRESS_BOOK_SYNC_TIMEOUT_MS,
    });
    return data;
  },
};

export default addressBookAPI;
