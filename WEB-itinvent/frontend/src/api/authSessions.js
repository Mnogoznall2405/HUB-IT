import apiClient from './client';

export const authSessionsAPI = {
  getSessions: async () => {
    const response = await apiClient.get('/auth/sessions');
    return response.data;
  },

  terminateSession: async (sessionId) => {
    const response = await apiClient.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`);
    return response.data;
  },

  cleanupSessions: async () => {
    const response = await apiClient.post('/auth/sessions/cleanup');
    return response.data;
  },

  purgeInactiveSessions: async () => {
    const response = await apiClient.post('/auth/sessions/purge-inactive');
    return response.data;
  },
};

export default authSessionsAPI;
