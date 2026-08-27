import apiClient from './client';
import {
  bulkMailMessageAction,
  createMailFolder,
  deleteMailFolder,
  deleteMailMessage,
  getMailAttachmentPreview,
  getMailConversation,
  getMailMessageHeaders,
  getMailMessages,
  markMailMessageRead,
  renameMailFolder,
  sendMailMessage,
  setMailFolderFavorite,
  summarizeMailMessage,
} from './mailApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: { items: [] } })),
    post: jest.fn(async () => ({ data: { ok: true } })),
    patch: jest.fn(async () => ({ data: { ok: true } })),
    delete: jest.fn(async () => ({ data: { ok: true } })),
  },
}));

const mockedClient = apiClient as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock; delete: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

it('marks exactly one mailbox-scoped message read', async () => {
  await markMailMessageRead('inbox/message 7', 'mailbox-2');
  expect(apiClient.post).toHaveBeenCalledWith(
    '/mail/messages/inbox%2Fmessage%207/read',
    null,
    { params: { mailbox_id: 'mailbox-2' } },
  );
});

it('uses the existing mailbox-scoped AI summary endpoint', async () => {
  mockedClient.post.mockResolvedValueOnce({ data: { summary: 'Кратко' } });
  await expect(summarizeMailMessage('message/7', 'box-1')).resolves.toEqual({ summary: 'Кратко' });
  expect(mockedClient.post).toHaveBeenCalledWith(
    '/mail/messages/message%2F7/summarize',
    null,
    { params: { mailbox_id: 'box-1' } },
  );
});

it('rejects a missing message identifier without calling the backend', async () => {
  await expect(markMailMessageRead('  ')).rejects.toThrow('идентификатор письма');
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('maps native list filters to the established mail query contract', async () => {
  mockedClient.get.mockResolvedValueOnce({
    data: { items: [], folder: 'inbox', limit: 25, offset: 0, total: 0, has_more: false },
  });
  await getMailMessages({
    mailboxId: 'box-1',
    folder: 'inbox',
    folderScope: 'all',
    limit: 25,
    q: 'смета',
    unreadOnly: true,
    hasAttachments: true,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-25',
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'смета',
    body: 'согласовать',
    importance: 'high',
  });
  expect(mockedClient.get).toHaveBeenCalledWith('/mail/messages', {
    params: {
      mailbox_id: 'box-1',
      folder: 'inbox',
      folder_scope: 'all',
      limit: 25,
      offset: 0,
      q: 'смета',
      unread_only: true,
      has_attachments: true,
      date_from: '2026-08-01',
      date_to: '2026-08-25',
      from_filter: 'sender@example.com',
      to_filter: 'recipient@example.com',
      subject_filter: 'смета',
      body_filter: 'согласовать',
      importance: 'high',
    },
  });
});

it('uses authenticated message headers and Office preview metadata endpoints', async () => {
  mockedClient.get
    .mockResolvedValueOnce({ data: { items: [{ name: 'From', value: 'sender@example.com' }] } })
    .mockResolvedValueOnce({ data: { status: 'ready', pdf_filename: 'preview.pdf' } });

  await expect(getMailMessageHeaders('message/1', 'box-1')).resolves.toEqual({
    items: [{ name: 'From', value: 'sender@example.com' }],
  });
  await expect(getMailAttachmentPreview('message/1', 'attachment/2', 'box-1')).resolves.toEqual({
    status: 'ready',
    pdf_filename: 'preview.pdf',
  });

  expect(mockedClient.get).toHaveBeenNthCalledWith(1, '/mail/messages/message%2F1/headers', { params: { mailbox_id: 'box-1' } });
  expect(mockedClient.get).toHaveBeenNthCalledWith(2, '/mail/messages/message%2F1/attachments/attachment%2F2/preview', { params: { mailbox_id: 'box-1' } });
});

it('loads a mailbox-scoped conversation with an encoded identifier', async () => {
  await getMailConversation('thread/7', { mailboxId: 'box-2', folder: 'sent' });
  expect(mockedClient.get).toHaveBeenCalledWith('/mail/conversations/thread%2F7', {
    params: { mailbox_id: 'box-2', folder: 'sent', folder_scope: 'current' },
  });
});

it('uses non-permanent delete by default', async () => {
  await deleteMailMessage('message-7', 'box-1');
  expect(mockedClient.post).toHaveBeenCalledWith('/mail/messages/message-7/delete', {
    mailbox_id: 'box-1',
    permanent: false,
  });
});

it('maps user-facing bulk read actions to backend action names', async () => {
  await bulkMailMessageAction({ mailboxId: 'box-1', action: 'read', messageIds: ['message-1'] });
  expect(mockedClient.post).toHaveBeenCalledWith('/mail/messages/bulk', {
    mailbox_id: 'box-1',
    action: 'mark_read',
    message_ids: ['message-1'],
    target_folder: '',
    permanent: false,
  });
});

it('uses the established folder mutation contracts', async () => {
  await createMailFolder({
    mailboxId: 'box-1',
    name: ' Проекты ',
    parentFolderId: 'parent/folder',
    scope: 'archive',
  });
  expect(mockedClient.post).toHaveBeenNthCalledWith(1, '/mail/folders', {
    mailbox_id: 'box-1',
    name: 'Проекты',
    parent_folder_id: 'parent/folder',
    scope: 'archive',
  });

  await renameMailFolder('custom/folder', 'box-1', ' Новый отдел ');
  expect(mockedClient.patch).toHaveBeenCalledWith('/mail/folders/custom%2Ffolder', {
    name: 'Новый отдел',
  }, { params: { mailbox_id: 'box-1' } });

  await setMailFolderFavorite('custom/folder', true, 'box-1');
  expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/mail/folders/custom%2Ffolder/favorite', {
    favorite: true,
    mailbox_id: 'box-1',
  });

  await deleteMailFolder('custom/folder', 'box-1');
  expect(mockedClient.delete).toHaveBeenCalledWith('/mail/folders/custom%2Ffolder', {
    params: { mailbox_id: 'box-1' },
  });
});

it('sends multipart mail with an idempotency key and extended timeout', async () => {
  await sendMailMessage({
    fromMailboxId: 'box-1',
    to: ['user@example.com'],
    subject: 'Нативное письмо',
    body: 'Текст',
    files: [{ uri: 'file:///one.pdf', name: 'one.pdf', mimeType: 'application/pdf', size: 10 }],
  }, { idempotencyKey: 'mail-idempotency-1' });
  expect(mockedClient.post).toHaveBeenCalledWith(
    '/mail/messages/send-multipart',
    expect.any(FormData),
    expect.objectContaining({
      headers: expect.objectContaining({ 'Idempotency-Key': 'mail-idempotency-1' }),
      timeout: 120_000,
    }),
  );
});
