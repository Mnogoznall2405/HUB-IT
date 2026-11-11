import apiClient from './client';
import { withMailboxQuery } from './mailMailboxQuery';

export const mailMessageDetailAPI = {
  getMessage: async (messageId, options = {}) => {
    const response = await apiClient.get(`/mail/messages/${encodeURIComponent(messageId)}`, {
      params: withMailboxQuery({}, options?.mailboxId),
      signal: options?.signal,
    });
    return response.data;
  },
};

export default mailMessageDetailAPI;
