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

export const mailMessageFilesAPI = {
  downloadAttachment: async (messageId, attachmentRef, options = {}) => {
    const response = await apiClient.get(
      `/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentRef)}`,
      {
        params: withMailboxQuery({}, options?.mailboxId),
        responseType: 'blob',
      }
    );
    return response;
  },

  getMessageHeaders: async (messageId, options = {}) => {
    const response = await apiClient.get(`/mail/messages/${encodeURIComponent(messageId)}/headers`, {
      params: withMailboxQuery({}, options?.mailboxId),
    });
    return response.data;
  },

  downloadMessageSource: async (messageId, options = {}) => {
    const response = await apiClient.get(`/mail/messages/${encodeURIComponent(messageId)}/eml`, {
      params: withMailboxQuery({}, options?.mailboxId),
      responseType: 'blob',
    });
    return response;
  },
};

export default mailMessageFilesAPI;
