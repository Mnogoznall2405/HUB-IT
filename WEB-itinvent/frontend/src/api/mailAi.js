import apiClient from './client';

const normalizeMailboxId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || '';
};

const withMailboxQuery = (params = {}, mailboxId) => {
  const normalizedMailboxId = normalizeMailboxId(mailboxId ?? params?.mailbox_id ?? params?.mailboxId);
  const nextParams = { ...(params || {}) };
  delete nextParams.mailboxId;
  if (normalizedMailboxId) {
    nextParams.mailbox_id = normalizedMailboxId;
  } else {
    delete nextParams.mailbox_id;
  }
  return nextParams;
};

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
