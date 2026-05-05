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
