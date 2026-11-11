import apiClient from './client';
import { withMailboxQuery } from './mailMailboxQuery';

const withSignal = (config, signal) => (signal ? { ...config, signal } : config);

export const mailMessageFilesAPI = {
  downloadAttachment: async (messageId, attachmentRef, options = {}) => {
    const response = await apiClient.get(
      `/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentRef)}`,
      withSignal({
        params: withMailboxQuery({}, options?.mailboxId),
        responseType: 'blob',
      }, options?.signal)
    );
    return response;
  },

  getAttachmentPreview: async (messageId, attachmentRef, options = {}) => {
    const response = await apiClient.get(
      `/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentRef)}/preview`,
      withSignal({
        params: withMailboxQuery({}, options?.mailboxId),
      }, options?.signal),
    );
    return response.data;
  },

  downloadAttachmentPreviewPdf: async (messageId, attachmentRef, options = {}) => (
    apiClient.get(
      `/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentRef)}/preview/pdf`,
      withSignal({
        params: withMailboxQuery({}, options?.mailboxId),
        responseType: 'blob',
      }, options?.signal),
    )
  ),

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
