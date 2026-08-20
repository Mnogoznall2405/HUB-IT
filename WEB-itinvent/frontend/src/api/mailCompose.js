import apiClient from './client';
import { takeMailSendIdempotencyKey, withMailSendIdempotencyHeaders } from '../components/mail/mailSendIdempotency';
import { withMailSendTimeout } from '../components/mail/mailSendOutcome';
import { normalizeMailboxId, withMailboxQuery } from './mailMailboxQuery';

export const mailComposeAPI = {
  searchContacts: async (q, options = {}) => {
    const response = await apiClient.get('/mail/contacts', {
      params: withMailboxQuery({ q }, options?.mailboxId),
    });
    return response.data?.items || [];
  },

  saveDraftMultipart: async ({
    fromMailboxId,
    draftId,
    composeMode,
    to,
    cc,
    bcc,
    subject,
    body,
    isHtml,
    replyToMessageId,
    forwardMessageId,
    retainExistingAttachments,
    files,
    onUploadProgress,
    signal,
  }) => {
    const formData = new FormData();
    formData.append('from_mailbox_id', normalizeMailboxId(fromMailboxId));
    formData.append('draft_id', draftId || '');
    formData.append('compose_mode', composeMode || 'draft');
    formData.append('to', (to || []).join(';'));
    formData.append('cc', (cc || []).join(';'));
    formData.append('bcc', (bcc || []).join(';'));
    formData.append('subject', subject || '');
    formData.append('body', body || '');
    formData.append('is_html', isHtml ? 'true' : 'false');
    formData.append('reply_to_message_id', replyToMessageId || '');
    formData.append('forward_message_id', forwardMessageId || '');
    formData.append('retain_existing_attachments_json', JSON.stringify(retainExistingAttachments || []));
    if (files && files.length > 0) {
      files.forEach((file) => {
        formData.append('files', file);
      });
    }
    const response = await apiClient.post('/mail/drafts/upsert-multipart', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
      signal,
    });
    return response.data;
  },

  deleteDraft: async (draftId, options = {}) => {
    const response = await apiClient.delete(
      `/mail/drafts/${encodeURIComponent(draftId)}`,
      { params: withMailboxQuery({}, options?.mailboxId) },
    );
    return response.data;
  },

  sendMessage: async (payload, options = {}) => {
    const { key, body } = takeMailSendIdempotencyKey(payload, options);
    const headers = withMailSendIdempotencyHeaders({}, key);
    const response = Object.keys(headers).length > 0
      ? await apiClient.post('/mail/messages/send', body, withMailSendTimeout({ headers }))
      : await apiClient.post('/mail/messages/send', body, withMailSendTimeout());
    return response.data;
  },

  sendMessageMultipart: async ({
    fromMailboxId,
    to,
    cc,
    bcc,
    subject,
    body,
    isHtml,
    files,
    retainExistingAttachments,
    replyToMessageId,
    forwardMessageId,
    draftId,
    idempotencyKey,
    onUploadProgress,
    signal,
  }) => {
    const formData = new FormData();
    formData.append('from_mailbox_id', normalizeMailboxId(fromMailboxId));
    formData.append('to', to.join(';'));
    formData.append('cc', (cc || []).join(';'));
    formData.append('bcc', (bcc || []).join(';'));
    formData.append('subject', subject || '');
    formData.append('body', body || '');
    formData.append('is_html', isHtml ? 'true' : 'false');
    formData.append('reply_to_message_id', replyToMessageId || '');
    formData.append('forward_message_id', forwardMessageId || '');
    formData.append('draft_id', draftId || '');
    formData.append('retain_existing_attachments_json', JSON.stringify(retainExistingAttachments || []));
    if (files && files.length > 0) {
      files.forEach((file) => {
        formData.append('files', file);
      });
    }
    const headers = withMailSendIdempotencyHeaders(
      { 'Content-Type': 'multipart/form-data' },
      idempotencyKey,
    );
    const response = await apiClient.post('/mail/messages/send-multipart', formData, withMailSendTimeout({
      headers,
      onUploadProgress,
      signal,
    }));
    return response.data;
  },
};

export default mailComposeAPI;
