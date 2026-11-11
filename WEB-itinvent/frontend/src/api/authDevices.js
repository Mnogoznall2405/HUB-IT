import apiClient from './client';

export const authDevicesAPI = {
  list: async () => (await apiClient.get('/auth/my-devices')).data,
  remove: async (id) => (await apiClient.delete(`/auth/my-devices/${encodeURIComponent(id)}`)).data,
  terminateSession: async (id) => (await apiClient.delete(`/auth/my-devices/sessions/${encodeURIComponent(id)}`)).data,
  terminateOthers: async () => (await apiClient.post('/auth/my-devices/terminate-others')).data,
};
