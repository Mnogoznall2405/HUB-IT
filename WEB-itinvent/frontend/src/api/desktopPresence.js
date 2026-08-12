import apiClient from './client';

export const desktopPresenceAPI = {
  heartbeat: async () => {
    const response = await apiClient.post('/desktop-presence/heartbeat', {});
    return response.data;
  },

  getStatus: async () => {
    const response = await apiClient.get('/desktop-presence/status');
    return response.data;
  },

  disconnect: async () => {
    const response = await apiClient.delete('/desktop-presence/current');
    return response.data;
  },
};

export default desktopPresenceAPI;
