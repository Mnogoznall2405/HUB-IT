import apiClient from './client';
import { withMailboxQuery } from './mailMailboxQuery';

export const mailAiAPI = {
  summarizeMessage: async (messageId, mailboxId = '', options = {}) => {
    const response = await apiClient.post(
      `/mail/messages/${encodeURIComponent(messageId)}/summarize`,
      null,
      {
        params: withMailboxQuery({}, mailboxId),
        signal: options?.signal,
      },
    );
    return response.data;
  },

  getSmartReplies: async (messageId, mailboxId = '', options = {}) => {
    const response = await apiClient.post(
      `/mail/messages/${encodeURIComponent(messageId)}/smart-replies`,
      null,
      {
        params: withMailboxQuery({}, mailboxId),
        signal: options?.signal,
      },
    );
    return response.data;
  },
};

export default mailAiAPI;
