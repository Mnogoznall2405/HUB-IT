import apiClient from './http';
import { takeMailSendIdempotencyKey, withMailSendIdempotencyHeaders } from '../components/mail/mailSendIdempotency';
import { withMailSendTimeout } from '../components/mail/mailSendOutcome';

export const mailItRequestsAPI = {
  sendItRequest: async (payload) => {
    const { key, body } = takeMailSendIdempotencyKey(payload);
    const headers = withMailSendIdempotencyHeaders({}, key);
    const response = await apiClient.post('/mail/messages/send-it-request', body, withMailSendTimeout(
      key ? { headers } : {},
    ));
    return response.data;
  },

  sendItRequestMultipart: async ({
    templateId,
    fields,
    files,
    onUploadProgress,
    signal,
    idempotencyKey,
  }) => {
    const formData = new FormData();
    formData.append('template_id', String(templateId || ''));
    formData.append('fields_json', JSON.stringify(fields || {}));
    if (Array.isArray(files) && files.length > 0) {
      files.forEach((file) => {
        if (file) {
          formData.append('files', file);
        }
      });
    }
    const response = await apiClient.post('/mail/messages/send-it-request-multipart', formData, withMailSendTimeout({
      headers: withMailSendIdempotencyHeaders({
        'Content-Type': 'multipart/form-data',
      }, idempotencyKey),
      onUploadProgress,
      signal,
    }));
    return response.data;
  },
};

export default mailItRequestsAPI;
