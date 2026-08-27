import type { AxiosProgressEvent } from 'axios';
import apiClient from './client';

export type MailPerson = {
  name?: string | null;
  email?: string | null;
  display?: string | null;
};

export type MailAttachment = {
  id?: string | null;
  download_token?: string | null;
  downloadable?: boolean;
  name: string;
  content_type?: string | null;
  size?: number | null;
  content_id?: string | null;
  is_inline?: boolean;
  inline_src?: string | null;
  inline_data_url?: string | null;
  /** Local-only authenticated image preview. Never sent back to the API. */
  native_preview_uri?: string | null;
};

export type MailMessagePreview = {
  id: string;
  mailbox_id?: string | null;
  exchange_id?: string | null;
  folder?: string | null;
  subject?: string | null;
  sender?: string | null;
  sender_person?: MailPerson | null;
  sender_name?: string | null;
  sender_email?: string | null;
  sender_display?: string | null;
  recipients?: string[];
  recipient_people?: MailPerson[];
  received_at?: string | null;
  is_read?: boolean;
  has_attachments?: boolean;
  attachments_count?: number | null;
  body_preview?: string | null;
  importance?: 'low' | 'normal' | 'high' | string;
  categories?: string[];
};

export type MailComposeVariant = {
  subject?: string | null;
  to?: string[];
  cc?: string[];
  quote_html?: string | null;
};

export type MailComposeContext = {
  mailbox_id?: string | null;
  mailbox_email?: string | null;
  reply?: MailComposeVariant | null;
  reply_all?: MailComposeVariant | null;
  forward?: MailComposeVariant | null;
};

export type MailDraftContext = {
  compose_mode?: string | null;
  mailbox_id?: string | null;
  reply_to_message_id?: string | null;
  forward_message_id?: string | null;
};

export type MailMessageDetail = MailMessagePreview & {
  to?: string[];
  to_people?: MailPerson[];
  cc?: string[];
  cc_people?: MailPerson[];
  bcc?: string[];
  bcc_people?: MailPerson[];
  body_html?: string | null;
  body_text?: string | null;
  internet_message_id?: string | null;
  conversation_id?: string | null;
  restore_hint_folder?: string | null;
  attachments?: MailAttachment[];
  compose_context?: MailComposeContext | null;
  draft_context?: MailDraftContext | null;
  has_external_images?: boolean;
  can_archive?: boolean;
  can_move?: boolean;
};

export type MailMessageSummary = {
  summary?: string | null;
};

export type MailMessagePage = {
  items: MailMessagePreview[];
  folder: string;
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
  next_offset?: number | null;
  search_limited?: boolean;
  searched_window?: number;
};

export type MailConversationPreview = {
  conversation_id: string;
  subject?: string | null;
  participants?: string[];
  participant_people?: MailPerson[];
  messages_count?: number;
  unread_count?: number;
  last_received_at?: string | null;
  has_attachments?: boolean;
  attachments_count?: number;
  preview?: string | null;
};

export type MailConversationPage = {
  items: MailConversationPreview[];
  folder: string;
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
  next_offset?: number | null;
  search_limited?: boolean;
  searched_window?: number;
};

export type MailConversationDetail = Omit<MailConversationPreview, 'has_attachments' | 'attachments_count' | 'preview'> & {
  items: MailMessageDetail[];
};

export type MailFolderSummaryEntry = { total?: number; unread?: number };
export type MailFolderSummary = Record<string, MailFolderSummaryEntry>;

export type MailFolderNode = {
  id?: string | null;
  folder_id?: string | null;
  key?: string | null;
  parent_id?: string | null;
  name?: string | null;
  label?: string | null;
  display_name?: string | null;
  scope?: string | null;
  icon_key?: string | null;
  well_known_key?: string | null;
  total?: number;
  unread?: number;
  is_favorite?: boolean;
  can_rename?: boolean;
  can_delete?: boolean;
  children?: MailFolderNode[];
};

export type MailListFilters = {
  mailboxId?: string;
  folder?: string;
  folderScope?: 'current' | 'all' | string;
  limit?: number;
  offset?: number;
  q?: string;
  unreadOnly?: boolean;
  hasAttachments?: boolean;
  dateFrom?: string;
  dateTo?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  importance?: string;
};

export type MailContact = MailPerson & {
  id?: string | number | null;
  value?: string | null;
};

export type MailUploadFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export type MailComposePayload = {
  fromMailboxId?: string;
  draftId?: string;
  composeMode?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  isHtml?: boolean;
  replyToMessageId?: string;
  forwardMessageId?: string;
  retainExistingAttachments?: string[];
  files?: MailUploadFile[];
};

export type MailDraftResult = {
  draft_id?: string | null;
  id?: string | null;
  attachments?: MailAttachment[];
  [key: string]: unknown;
};

export type MailActionResult = { ok?: boolean; affected?: number; [key: string]: unknown };

export type MailMessageHeader = { name?: string | null; value?: string | null };
export type MailMessageHeaders = { items: MailMessageHeader[]; [key: string]: unknown };
export type MailAttachmentPreview = {
  status?: 'queued' | 'processing' | 'ready' | 'failed' | string;
  retry_after_ms?: number;
  pdf_filename?: string | null;
  page_count?: number;
  detail?: string | null;
  [key: string]: unknown;
};

export type MailFolderCreatePayload = {
  mailboxId?: string;
  name: string;
  parentFolderId?: string;
  scope?: 'mailbox' | 'archive';
};

function normalizeId(value: unknown, label: string, maxLength: number): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw new Error(label);
  return normalized;
}

function mailboxParams(mailboxId?: string): Record<string, string> {
  const normalized = String(mailboxId || '').trim();
  if (normalized.length > 256) throw new Error('Некорректный почтовый ящик');
  return normalized ? { mailbox_id: normalized } : {};
}

function listParams(filters: MailListFilters): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    ...mailboxParams(filters.mailboxId),
    folder: String(filters.folder || 'inbox'),
    folder_scope: String(filters.folderScope || 'current'),
    limit: Math.max(1, Math.min(200, Number(filters.limit || 50))),
    offset: Math.max(0, Number(filters.offset || 0)),
  };
  const strings: Array<[keyof MailListFilters, string]> = [
    ['q', 'q'],
    ['dateFrom', 'date_from'],
    ['dateTo', 'date_to'],
    ['from', 'from_filter'],
    ['to', 'to_filter'],
    ['subject', 'subject_filter'],
    ['body', 'body_filter'],
    ['importance', 'importance'],
  ];
  strings.forEach(([source, target]) => {
    const value = String(filters[source] || '').trim();
    if (value) params[target] = value;
  });
  if (filters.unreadOnly) params.unread_only = true;
  if (filters.hasAttachments) params.has_attachments = true;
  return params;
}

function appendComposeFields(formData: FormData, payload: MailComposePayload): void {
  formData.append('from_mailbox_id', String(payload.fromMailboxId || '').trim());
  formData.append('to', payload.to.join(';'));
  formData.append('cc', (payload.cc || []).join(';'));
  formData.append('bcc', (payload.bcc || []).join(';'));
  formData.append('subject', String(payload.subject || ''));
  formData.append('body', String(payload.body || ''));
  formData.append('is_html', payload.isHtml ? 'true' : 'false');
  formData.append('reply_to_message_id', String(payload.replyToMessageId || ''));
  formData.append('forward_message_id', String(payload.forwardMessageId || ''));
  formData.append('draft_id', String(payload.draftId || ''));
  formData.append('retain_existing_attachments_json', JSON.stringify(payload.retainExistingAttachments || []));
  (payload.files || []).forEach((file) => {
    formData.append('files', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    } as unknown as Blob);
  });
  formData.append('inline_content_ids_json', '[]');
}

export async function getMailMessages(filters: MailListFilters = {}): Promise<MailMessagePage> {
  const { data } = await apiClient.get<MailMessagePage>('/mail/messages', { params: listParams(filters) });
  return data;
}

export async function getMailMessage(messageId: string, mailboxId = ''): Promise<MailMessageDetail> {
  const id = normalizeId(messageId, 'Не указан идентификатор письма', 8_192);
  const { data } = await apiClient.get<MailMessageDetail>(`/mail/messages/${encodeURIComponent(id)}`, {
    params: mailboxParams(mailboxId),
  });
  return data;
}

export async function summarizeMailMessage(messageId: string, mailboxId = ''): Promise<MailMessageSummary> {
  const id = normalizeId(messageId, 'Не указан идентификатор письма', 8_192);
  const { data } = await apiClient.post<MailMessageSummary>(
    `/mail/messages/${encodeURIComponent(id)}/summarize`,
    null,
    { params: mailboxParams(mailboxId) },
  );
  return data;
}

export async function getMailMessageHeaders(messageId: string, mailboxId = ''): Promise<MailMessageHeaders> {
  const id = normalizeId(messageId, 'Не указан идентификатор письма', 8_192);
  const { data } = await apiClient.get<MailMessageHeaders>(`/mail/messages/${encodeURIComponent(id)}/headers`, {
    params: mailboxParams(mailboxId),
  });
  return { ...data, items: Array.isArray(data?.items) ? data.items : [] };
}

export async function getMailAttachmentPreview(
  messageId: string,
  attachmentRef: string,
  mailboxId = '',
): Promise<MailAttachmentPreview> {
  const id = normalizeId(messageId, 'Не указано письмо', 8_192);
  const ref = normalizeId(attachmentRef, 'У вложения нет идентификатора', 8_192);
  const { data } = await apiClient.get<MailAttachmentPreview>(
    `/mail/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(ref)}/preview`,
    { params: mailboxParams(mailboxId) },
  );
  return data;
}

export async function getMailConversations(filters: MailListFilters = {}): Promise<MailConversationPage> {
  const { data } = await apiClient.get<MailConversationPage>('/mail/conversations', { params: listParams(filters) });
  return data;
}

export async function getMailConversation(
  conversationId: string,
  filters: Pick<MailListFilters, 'mailboxId' | 'folder' | 'folderScope'> = {},
): Promise<MailConversationDetail> {
  const id = normalizeId(conversationId, 'Не указан идентификатор переписки', 8_192);
  const { data } = await apiClient.get<MailConversationDetail>(
    `/mail/conversations/${encodeURIComponent(id)}`,
    {
      params: {
        ...mailboxParams(filters.mailboxId),
        folder: String(filters.folder || 'inbox'),
        folder_scope: String(filters.folderScope || 'current'),
      },
    },
  );
  return data;
}

export async function getMailFolderSummary(mailboxId = ''): Promise<MailFolderSummary> {
  const { data } = await apiClient.get<{ items?: MailFolderSummary }>('/mail/folders/summary', {
    params: mailboxParams(mailboxId),
  });
  return data?.items && typeof data.items === 'object' ? data.items : {};
}

export async function getMailFolderTree(mailboxId = ''): Promise<{ items: MailFolderNode[]; [key: string]: unknown }> {
  const { data } = await apiClient.get<{ items?: MailFolderNode[]; [key: string]: unknown }>('/mail/folders/tree', {
    params: mailboxParams(mailboxId),
  });
  return { ...data, items: Array.isArray(data?.items) ? data.items : [] };
}

function normalizeFolderName(value: unknown): string {
  const name = String(value || '').trim();
  if (!name) throw new Error('Укажите название папки');
  if (name.length > 255) throw new Error('Название папки слишком длинное');
  return name;
}

export async function createMailFolder(payload: MailFolderCreatePayload): Promise<MailFolderNode> {
  const parentFolderId = String(payload.parentFolderId || '').trim();
  if (parentFolderId.length > 2_048) throw new Error('Некорректная родительская папка');
  const { data } = await apiClient.post<MailFolderNode>('/mail/folders', {
    mailbox_id: String(payload.mailboxId || '').trim(),
    name: normalizeFolderName(payload.name),
    parent_folder_id: parentFolderId,
    scope: payload.scope === 'archive' ? 'archive' : 'mailbox',
  });
  return data;
}

export async function renameMailFolder(folderId: string, mailboxId: string, name: string): Promise<MailFolderNode> {
  const id = normalizeId(folderId, 'Не указана папка', 2_048);
  const { data } = await apiClient.patch<MailFolderNode>(`/mail/folders/${encodeURIComponent(id)}`, {
    name: normalizeFolderName(name),
  }, { params: mailboxParams(mailboxId) });
  return data;
}

export async function deleteMailFolder(folderId: string, mailboxId = ''): Promise<MailActionResult> {
  const id = normalizeId(folderId, 'Не указана папка', 2_048);
  const { data } = await apiClient.delete<MailActionResult>(`/mail/folders/${encodeURIComponent(id)}`, {
    params: mailboxParams(mailboxId),
  });
  return data;
}

export async function setMailFolderFavorite(
  folderId: string,
  favorite: boolean,
  mailboxId = '',
): Promise<MailFolderNode> {
  const id = normalizeId(folderId, 'Не указана папка', 2_048);
  const { data } = await apiClient.post<MailFolderNode>(`/mail/folders/${encodeURIComponent(id)}/favorite`, {
    favorite,
    mailbox_id: String(mailboxId || '').trim() || undefined,
  });
  return data;
}

export async function markMailMessageRead(messageId: string, mailboxId = ''): Promise<void> {
  const id = normalizeId(messageId, 'В уведомлении отсутствует идентификатор письма', 8_192);
  await apiClient.post(`/mail/messages/${encodeURIComponent(id)}/read`, null, {
    params: mailboxParams(mailboxId),
  });
}

export async function markMailMessageUnread(messageId: string, mailboxId = ''): Promise<void> {
  const id = normalizeId(messageId, 'Не указан идентификатор письма', 8_192);
  await apiClient.post(`/mail/messages/${encodeURIComponent(id)}/unread`, null, {
    params: mailboxParams(mailboxId),
  });
}

export async function setMailMessageImportance(
  messageId: string,
  importance: 'low' | 'normal' | 'high',
  mailboxId = '',
): Promise<MailActionResult> {
  const id = normalizeId(messageId, 'Не указан идентификатор письма', 8_192);
  const { data } = await apiClient.post<MailActionResult>(`/mail/messages/${encodeURIComponent(id)}/importance`, {
    importance,
    mailbox_id: String(mailboxId || '').trim() || undefined,
  });
  return data;
}

export async function moveMailMessage(messageId: string, mailboxId: string, targetFolder: string): Promise<MailActionResult> {
  const id = normalizeId(messageId, 'Не указан идентификатор письма', 8_192);
  const folder = normalizeId(targetFolder, 'Не указана папка назначения', 2_048);
  const { data } = await apiClient.post<MailActionResult>(`/mail/messages/${encodeURIComponent(id)}/move`, {
    mailbox_id: String(mailboxId || '').trim(),
    target_folder: folder,
  });
  return data;
}

export async function deleteMailMessage(messageId: string, mailboxId: string, permanent = false): Promise<MailActionResult> {
  const id = normalizeId(messageId, 'Не указан идентификатор письма', 8_192);
  const { data } = await apiClient.post<MailActionResult>(`/mail/messages/${encodeURIComponent(id)}/delete`, {
    mailbox_id: String(mailboxId || '').trim(),
    permanent,
  });
  return data;
}

export async function restoreMailMessage(messageId: string, mailboxId: string, targetFolder = ''): Promise<MailActionResult> {
  const id = normalizeId(messageId, 'Не указан идентификатор письма', 8_192);
  const { data } = await apiClient.post<MailActionResult>(`/mail/messages/${encodeURIComponent(id)}/restore`, {
    mailbox_id: String(mailboxId || '').trim(),
    target_folder: String(targetFolder || '').trim(),
  });
  return data;
}

export async function bulkMailMessageAction(payload: {
  mailboxId?: string;
  action: 'read' | 'unread' | 'mark_read' | 'mark_unread' | 'move' | 'delete' | 'archive' | string;
  messageIds: string[];
  targetFolder?: string;
  permanent?: boolean;
}): Promise<MailActionResult> {
  const messageIds = payload.messageIds
    .map((id) => normalizeId(id, 'Выбрано письмо без идентификатора', 8_192));
  const action = payload.action === 'read'
    ? 'mark_read'
    : payload.action === 'unread'
      ? 'mark_unread'
      : payload.action;
  const { data } = await apiClient.post<MailActionResult>('/mail/messages/bulk', {
    mailbox_id: String(payload.mailboxId || '').trim(),
    action,
    message_ids: messageIds,
    target_folder: String(payload.targetFolder || '').trim(),
    permanent: Boolean(payload.permanent),
  });
  return data;
}

export async function markAllMailMessagesRead(payload: {
  mailboxId?: string;
  folder?: string;
  folderScope?: string;
} = {}): Promise<MailActionResult> {
  const { data } = await apiClient.post<MailActionResult>('/mail/messages/mark-all-read', {
    mailbox_id: String(payload.mailboxId || '').trim(),
    folder: String(payload.folder || 'inbox'),
    folder_scope: String(payload.folderScope || 'current'),
  });
  return data;
}

export async function setMailConversationRead(
  conversationId: string,
  read: boolean,
  payload: { mailboxId?: string; folder?: string; folderScope?: string } = {},
): Promise<MailActionResult> {
  const id = normalizeId(conversationId, 'Не указан идентификатор переписки', 8_192);
  const { data } = await apiClient.post<MailActionResult>(
    `/mail/conversations/${encodeURIComponent(id)}/${read ? 'read' : 'unread'}`,
    {
      mailbox_id: String(payload.mailboxId || '').trim(),
      folder: String(payload.folder || 'inbox'),
      folder_scope: String(payload.folderScope || 'current'),
    },
  );
  return data;
}

export async function searchMailContacts(q: string, mailboxId = ''): Promise<MailContact[]> {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const { data } = await apiClient.get<{ items?: MailContact[] }>('/mail/contacts', {
    params: { ...mailboxParams(mailboxId), q: query.slice(0, 256) },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function saveMailDraft(
  payload: MailComposePayload,
  options: { signal?: AbortSignal; onUploadProgress?: (event: AxiosProgressEvent) => void } = {},
): Promise<MailDraftResult> {
  const formData = new FormData();
  appendComposeFields(formData, payload);
  formData.append('compose_mode', String(payload.composeMode || 'draft'));
  const { data } = await apiClient.post<MailDraftResult>('/mail/drafts/upsert-multipart', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal: options.signal,
    onUploadProgress: options.onUploadProgress,
  });
  return data;
}

export async function deleteMailDraft(draftId: string, mailboxId = ''): Promise<MailActionResult> {
  const id = normalizeId(draftId, 'Не указан идентификатор черновика', 8_192);
  const { data } = await apiClient.delete<MailActionResult>(`/mail/drafts/${encodeURIComponent(id)}`, {
    params: mailboxParams(mailboxId),
  });
  return data;
}

export async function sendMailMessage(
  payload: MailComposePayload,
  options: {
    idempotencyKey: string;
    signal?: AbortSignal;
    onUploadProgress?: (event: AxiosProgressEvent) => void;
  },
): Promise<Record<string, unknown>> {
  const key = normalizeId(options.idempotencyKey, 'Не удалось подготовить безопасную отправку письма', 256);
  const formData = new FormData();
  appendComposeFields(formData, payload);
  const { data } = await apiClient.post<Record<string, unknown>>('/mail/messages/send-multipart', formData, {
    headers: { 'Content-Type': 'multipart/form-data', 'Idempotency-Key': key },
    timeout: 120_000,
    signal: options.signal,
    onUploadProgress: options.onUploadProgress,
  });
  return data;
}
