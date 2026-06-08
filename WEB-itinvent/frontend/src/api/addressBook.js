import apiClient from './client';

export const ADDRESS_BOOK_SYNC_TIMEOUT_MS = 120_000;

export const addressBookAPI = {
  search: async ({ q = '', limit = 50 } = {}) => {
    const { data } = await apiClient.get('/address-book/search', {
      params: {
        q,
        limit,
      },
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
