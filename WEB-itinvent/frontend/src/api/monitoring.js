import apiClient from './client';

const root = '/monitoring';
export const monitoringAPI = {
  overview: async (signal) => (await apiClient.get(`${root}/overview`, { signal })).data,
  catalog: async () => (await apiClient.get(`${root}/catalog`)).data,
  profiles: async () => (await apiClient.get(`${root}/profiles`)).data,
  saveProfile: async (data, id) => (await (id ? apiClient.patch(`${root}/profiles/${id}`, data) : apiClient.post(`${root}/profiles`, data))).data,
  detail: async (id, signal) => (await apiClient.get(`${root}/targets/${id}`, { signal })).data,
  saveTarget: async (data, id) => (await (id ? apiClient.put(`${root}/targets/${id}`, data) : apiClient.post(`${root}/targets`, data))).data,
  deleteTarget: async (id) => apiClient.delete(`${root}/targets/${id}`),
  probe: async (id) => (await apiClient.post(`${root}/targets/${id}/probe`, null, { timeout: 30000 })).data,
  saveInterface: async (target, id, data) => (await apiClient.put(`${root}/targets/${target}/interfaces/${id}`, data)).data,
  history: async (id, { interfaceId = '', hours = 24, start, end, signal } = {}) => (await apiClient.get(`${root}/targets/${id}/history`, { params: { interface_id: interfaceId, hours, start, end }, signal })).data,
  events: async (targetId, signal) => (await apiClient.get(`${root}/events`, { params: { target_id: targetId || undefined }, signal })).data,
};
