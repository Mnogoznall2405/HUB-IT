import apiClient, { getCachedGet } from './client';

const PUSH_CONFIG_STALE_TIME_MS = 60_000;

export const settingsAPI = {
  getMySettings: async (options = {}) => {
    const response = await apiClient.get('/settings/me', {
      suppressAuthRequired: Boolean(options?.suppressAuthRequired),
    });
    return response.data;
  },
  updateMySettings: async (payload) => {
    const response = await apiClient.patch('/settings/me', payload);
    return response.data;
  },
  getAppSettings: async () => {
    const response = await apiClient.get('/settings/app');
    return response.data;
  },
  updateAppSettings: async (payload) => {
    const response = await apiClient.patch('/settings/app', payload);
    return response.data;
  },
  getEnvSettings: async () => {
    const response = await apiClient.get('/settings/env');
    return response.data;
  },
  updateEnvSettings: async (items) => {
    const response = await apiClient.patch('/settings/env', { items });
    return response.data;
  },
  getNotificationPushConfig: async (options = {}) => {
    return getCachedGet(
      'settings-notification-push-config',
      '/settings/notifications/push-config',
      {
        staleTimeMs: PUSH_CONFIG_STALE_TIME_MS,
        force: Boolean(options?.force),
      },
    );
  },
  upsertNotificationPushSubscription: async (payload) => {
    const response = await apiClient.put('/settings/notifications/push-subscription', payload);
    return response.data;
  },
  deleteNotificationPushSubscription: async (endpoint) => {
    const response = await apiClient.delete('/settings/notifications/push-subscription', {
      data: { endpoint },
    });
    return response.data;
  },
  getNativePushStatus: async () => {
    const response = await apiClient.get('/settings/notifications/native-push-status');
    return response.data;
  },
  upsertNativePushToken: async (payload) => {
    const response = await apiClient.put('/settings/notifications/native-push-token', payload);
    return response.data;
  },
  deleteNativePushToken: async (token) => {
    const response = await apiClient.delete('/settings/notifications/native-push-token', {
      data: { token },
    });
    return response.data;
  },
  getNotificationPreferences: async () => {
    const response = await apiClient.get('/settings/notifications/preferences');
    return response.data;
  },
  updateNotificationPreferences: async (payload) => {
    const response = await apiClient.patch('/settings/notifications/preferences', payload);
    return response.data;
  },
  getAiBots: async () => {
    const response = await apiClient.get('/ai-bots');
    return response.data;
  },
  createAiBot: async (payload) => {
    const response = await apiClient.post('/ai-bots', payload);
    return response.data;
  },
  updateAiBot: async (botId, payload) => {
    const response = await apiClient.patch(`/ai-bots/${encodeURIComponent(botId)}`, payload);
    return response.data;
  },
  getAiBotRuns: async (botId) => {
    const response = await apiClient.get(`/ai-bots/${encodeURIComponent(botId)}/runs`);
    return response.data;
  },
};

export default settingsAPI;
