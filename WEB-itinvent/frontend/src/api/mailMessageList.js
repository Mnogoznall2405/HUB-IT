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

export const mailMessageListAPI = {
  getBootstrap: async (params = {}) => {
    const response = await apiClient.get('/mail/bootstrap', { params: withMailboxQuery(params) });
    return response.data;
  },

  getMessages: async (params = {}) => {
    const response = await apiClient.get('/mail/messages', { params: withMailboxQuery(params) });
    return response.data;
  },

  getInbox: async (params = {}) => {
    return mailMessageListAPI.getMessages(params);
  },
};

export default mailMessageListAPI;
