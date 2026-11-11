import apiClient from './client';

// PART_NO, для которых в номенклатуре 1С (локальный снимок каталога) нет такого кода.
// available=false — снимок не готов: ни одну строку по догадке не помечаем.
export const warehousePartNoCheckAPI = {
  check: async (codes) => {
    const { data } = await apiClient.post('/warehouse-1c/part-no-check', { codes });
    return {
      available: Boolean(data?.available),
      missing: Array.isArray(data?.missing) ? data.missing.map(String) : [],
    };
  },
};

export default warehousePartNoCheckAPI;
