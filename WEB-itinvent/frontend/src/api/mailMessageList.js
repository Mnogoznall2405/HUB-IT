import apiClient from './client';
import { withMailboxQuery } from './mailMailboxQuery';

const withSignal = (config, signal) => (signal ? { ...config, signal } : config);

export const mailMessageListAPI = {
  getBootstrap: async (params = {}, options = {}) => {
    const response = await apiClient.get('/mail/bootstrap', withSignal({
      params: withMailboxQuery(params),
    }, options?.signal));
    return response.data;
  },

  getMessages: async (params = {}, options = {}) => {
    const response = await apiClient.get('/mail/messages', withSignal({
      params: withMailboxQuery(params),
    }, options?.signal));
    return response.data;
  },

  getInbox: async (params = {}, options = {}) => {
    if (options?.signal) {
      return mailMessageListAPI.getMessages(params, options);
    }
    return mailMessageListAPI.getMessages(params);
  },
};

export default mailMessageListAPI;
