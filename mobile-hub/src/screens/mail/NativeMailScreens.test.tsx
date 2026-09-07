import { File, Paths } from 'expo-file-system';
import { clearMailComposeDrafts, createMailComposeDraftSession } from '../../mail/nativeMailComposeDrafts';
import { createMailComposeTransfer } from '../../mail/nativeMailComposeTransfer';
import * as SecureStore from 'expo-secure-store';
import * as quickReplyDraftStore from '../../mail/mailQuickReplyDrafts';
import { clearMailQuickReplyDrafts, createMailQuickReplyDraftSession } from '../../mail/mailQuickReplyDrafts';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, StyleSheet } from 'react-native';
import * as mailApi from '../../api/mailApi';
import * as mailConfigApi from '../../api/mailConfigApi';
import * as mailboxApi from '../../api/mailMailboxesApi';
import { pickMailAttachments } from '../../mail/nativeMailFiles';
import { writeNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import * as snapshotCache from '../../cache/nativeSnapshotCache';
import { NativeMailComposeScreen } from './NativeMailComposeScreen';
import { NativeMailConversationScreen } from './NativeMailConversationScreen';
import { NativeMailInboxScreen } from './NativeMailInboxScreen';
import { NativeMailMessageScreen } from './NativeMailMessageScreen';

const mockRichInject = jest.fn();
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WebView: React.forwardRef((props: object, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: (code: string) => mockRichInject(code) }));
    return React.createElement(View, props);
  }) };
});

let mockPermissions = ['mail.access'];
let mockOfflineMode = false;
let mockUserId = 1;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mockUserId, username: 'mail-user', role: 'user', permissions: mockPermissions },
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));


jest.mock('expo-print', () => ({ printAsync: jest.fn(async () => undefined) }));

jest.mock('../../api/mailMailboxesApi', () => ({ listMailboxes: jest.fn() }));

jest.mock('../../api/mailConfigApi', () => ({
  getNativeMailPreferences: jest.fn(),
  DEFAULT_NATIVE_MAIL_PREFERENCES: {
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: false,
    show_preview_snippets: true,
    show_favorites_first: true,
  },
}));

jest.mock('../../api/mailApi', () => ({
  getMailMessages: jest.fn(),
  getMailConversations: jest.fn(),
  getMailFolderSummary: jest.fn(),
  getMailFolderTree: jest.fn(),
  getMailMessage: jest.fn(),
  getMailMessageHeaders: jest.fn(),
  getMailAttachmentPreview: jest.fn(),
  getMailConversation: jest.fn(),
  markMailMessageRead: jest.fn(),
  markMailMessageUnread: jest.fn(),
  markAllMailMessagesRead: jest.fn(),
  setMailMessageImportance: jest.fn(),
  moveMailMessage: jest.fn(),
  deleteMailMessage: jest.fn(),
  restoreMailMessage: jest.fn(),
  bulkMailMessageAction: jest.fn(),
  setMailConversationRead: jest.fn(),
  searchMailContacts: jest.fn(),
  saveMailDraft: jest.fn(),
  deleteMailDraft: jest.fn(),
  sendMailMessage: jest.fn(),
  summarizeMailMessage: jest.fn(),
}));

jest.mock('../../mail/nativeMailFiles', () => ({
  pickMailAttachments: jest.fn(async (items) => items),
  downloadMailAttachment: jest.fn(),
  downloadMailAttachmentPreviewPdf: jest.fn(),
  downloadMailMessageSource: jest.fn(),
  hydrateNativeMailImages: jest.fn(async (_messageId, _mailboxId, attachments) => attachments),
  canPreviewMailAttachment: jest.fn(() => false),
}));

jest.mock('../../mail/nativeMailAttachmentSave', () => ({
  saveNativeMailAttachmentsToDirectory: jest.fn(),
}), { virtual: true });

jest.mock('../../files/nativeAttachmentDownloads', () => ({
  openNativeFile: jest.fn(),
  shareNativeFile: jest.fn(),
}));

const mockedParams = useLocalSearchParams as jest.Mock;

const message = {
  id: 'message-1',
  mailbox_id: 'box-1',
  folder: 'inbox',
  subject: 'План работ',
  sender_display: 'Иван Петров',
  sender_person: { display: 'Иван Петров', email: 'ivan@example.com' },
  received_at: '2026-08-24T10:00:00+05:00',
  is_read: false,
  body_preview: 'Проверьте обновлённый план',
  body_text: 'Проверьте обновлённый план',
  to: ['me@example.com'],
  to_people: [{ display: 'Я', email: 'me@example.com' }],
  attachments: [],
  can_archive: true,
  compose_context: {
    reply: { subject: 'Re: План работ', to: ['ivan@example.com'], cc: [] },
    reply_all: { subject: 'Re: План работ', to: ['ivan@example.com'], cc: ['copy@example.com'] },
    forward: { subject: 'Fwd: План работ', to: [], cc: [] },
  },
};

it('does not carry hidden recipients from a restored reply into another source message', async () => {
  const scope = { userId: 1, mailboxId: 'box-1', sourceId: 'message-1', mode: 'reply' };
  await createMailComposeDraftSession(scope).write({
    draftId: '', to: 'ivan@example.com', cc: '', bcc: 'private@example.test', subject: 'Reply A', body: 'Draft A',
    quoteHtml: '', replyToMessageId: 'message-1', forwardMessageId: '', retainedAttachments: [], files: [],
  });
  mockedParams.mockReturnValue({ mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-1' });
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body').props.value).toBe('Draft A'));
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({ ...message, id: 'message-2' });
  mockedParams.mockReturnValue({ mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-2' });
  await view.rerender(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-subject').props.value).toBe('Re: План работ'));
  await fireEvent.press(view.getByLabelText('Добавить копию'));
  expect(view.getByLabelText('Скрытая копия').props.value).toBe('');
  expect((await createMailComposeDraftSession(scope).read())?.bcc).toBe('private@example.test');
});

it.each(['reply', 'reply_all', 'forward'])('ignores a late previous source while typing a %s for the current source', async (mode) => {
  let finishOld!: (value: unknown) => void;
  (mailApi.getMailMessage as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  mockedParams.mockReturnValue({ mode, mailboxId: 'box-1', sourceMessageId: 'old-source' });
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(mailApi.getMailMessage).toHaveBeenCalledWith('old-source', 'box-1'));
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({ ...message, id: 'current-source' });
  mockedParams.mockReturnValue({ mode, mailboxId: 'box-1', sourceMessageId: 'current-source' });
  await view.rerender(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Current typed reply');
  await act(async () => { finishOld({ ...message, id: 'old-source', subject: 'Obsolete source' }); });
  expect(view.getByTestId('native-mail-body').props.value).toBe('Current typed reply');
  expect(view.getByTestId('native-mail-subject').props.value).toBe(mode === 'forward' ? 'Fwd: План работ' : 'Re: План работ');
});

it('does not copy a local new-message draft into another mailbox', async () => {
  const scope = { userId: 1, mailboxId: 'box-1', sourceId: '', mode: 'new' };
  await createMailComposeDraftSession(scope).write({
    draftId: '', to: 'first@example.test', cc: '', bcc: 'private@example.test', subject: 'First mailbox', body: 'First draft',
    quoteHtml: '', replyToMessageId: '', forwardMessageId: '', retainedAttachments: [], files: [],
  });
  mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1' });
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body').props.value).toBe('First draft'));
  mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-2' });
  await view.rerender(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body').props.value).toBe(''));
  expect(view.getByTestId('native-mail-to').props.value).toBe('');
  expect(view.getByTestId('native-mail-subject').props.value).toBe('');
  expect((await createMailComposeDraftSession(scope).read())?.body).toBe('First draft');
});

it('takes a new quick-reply transfer when the existing editor receives a new transfer id', async () => {
  const transferScope = { userId: 1, mailboxId: 'box-1', messageId: 'message-1' };
  const first = createMailComposeTransfer({ ...transferScope, text: 'First transfer' });
  mockedParams.mockReturnValue({ mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-1', transferId: first });
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body').props.value).toBe('First transfer'));
  const second = createMailComposeTransfer({ ...transferScope, text: 'Second transfer' });
  expect(second).not.toBe(first);
  mockedParams.mockReturnValue({ mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-1', transferId: second });
  await view.rerender(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body').props.value).toBe('Second transfer'));
});

it.each(['new', 'reply', 'draft'])('offers only the current user local %s drafts offline without knowing a mailbox', async (mode) => {
  const local = { draftId: '', to: 'local@example.test', cc: '', bcc: '', subject: 'Offline letter', body: 'Offline text',
    quoteHtml: '', replyToMessageId: '', forwardMessageId: '', retainedAttachments: [], files: [], richDraftRequiresWeb: false };
  await createMailComposeDraftSession({ userId: 1, mailboxId: 'box-1', sourceId: mode === 'new' ? '' : 'source-offline', mode }).write(local);
  await createMailComposeDraftSession({ userId: 2, mailboxId: 'private-box', sourceId: '', mode: 'new' }).write({ ...local, subject: 'Other user' });
  mockOfflineMode = true;
  mockedParams.mockReturnValue({});
  const view = await render(<NativeMailComposeScreen />);
  await view.findByText('Offline letter');
  expect(view.queryByText('Other user')).toBeNull();
  expect(mailboxApi.listMailboxes).not.toHaveBeenCalled();
  expect(mailApi.getMailMessage).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Offline letter'));
  const destination = jest.mocked(router.setParams).mock.calls.at(-1)?.[0];
  mockedParams.mockReturnValue(destination);
  await view.rerender(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body').props.value).toBe('Offline text'));
  expect(mailboxApi.listMailboxes).not.toHaveBeenCalled();
});

it('saves a new offline letter for a known mailbox even when no local draft existed', async () => {
  mockOfflineMode = true;
  mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'offline-new-box' });
  const view = await render(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'New offline text');
  await view.unmount();
  const saved = await createMailComposeDraftSession({ userId: 1, mailboxId: 'offline-new-box', sourceId: '', mode: 'new' }).read();
  expect(saved?.body).toBe('New offline text');
  expect(mailboxApi.listMailboxes).not.toHaveBeenCalled();
  expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
});

beforeEach(async () => {
  await clearMailQuickReplyDrafts();
  jest.clearAllMocks();
  [
    mailboxApi.listMailboxes,
    mailConfigApi.getNativeMailPreferences,
    mailApi.getMailMessages,
    mailApi.getMailConversations,
    mailApi.getMailFolderSummary,
    mailApi.getMailFolderTree,
    mailApi.getMailMessage,
    mailApi.getMailMessageHeaders,
    mailApi.getMailConversation,
    mailApi.markMailMessageRead,
    mailApi.markMailMessageUnread,
    mailApi.markAllMailMessagesRead,
    mailApi.moveMailMessage,
    mailApi.deleteMailMessage,
    mailApi.restoreMailMessage,
    mailApi.bulkMailMessageAction,
    mailApi.setMailConversationRead,
    mailApi.searchMailContacts,
    mailApi.saveMailDraft,
    mailApi.sendMailMessage,
    mailApi.summarizeMailMessage,
  ].forEach((mock) => (mock as jest.Mock).mockReset());
  mockPermissions = ['mail.access'];
  mockOfflineMode = false;
  mockUserId = 1;
  mockedParams.mockReturnValue({});
  (mailboxApi.listMailboxes as jest.Mock).mockResolvedValue([
    { id: 'box-1', label: 'Рабочая почта', mailbox_email: 'me@example.com', is_primary: true, is_active: true, unread_count: 1 },
  ]);
  (mailApi.getMailMessages as jest.Mock).mockResolvedValue({ items: [message], folder: 'inbox', limit: 50, offset: 0, total: 1, has_more: false });
  (mailApi.getMailConversations as jest.Mock).mockResolvedValue({ items: [], folder: 'inbox', limit: 50, offset: 0, total: 0, has_more: false });
  (mailApi.getMailFolderSummary as jest.Mock).mockResolvedValue({ inbox: { total: 1, unread: 1 } });
  (mailApi.getMailFolderTree as jest.Mock).mockResolvedValue({
    items: [
      { id: 'inbox', label: 'Входящие', well_known_key: 'inbox', unread: 1 },
      { id: 'custom-projects', label: 'Проекты', unread: 2 },
    ],
  });
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue(message);
  (mailApi.getMailMessageHeaders as jest.Mock).mockResolvedValue({ items: [{ name: 'From', value: 'ivan@example.com' }] });
  (mailApi.getMailConversation as jest.Mock).mockResolvedValue({
    conversation_complete: true,
    conversation_id: 'thread-1',
    subject: 'План работ',
    participants: ['ivan@example.com'],
    messages_count: 1,
    unread_count: 1,
    items: [message],
  });
  (mailApi.markMailMessageRead as jest.Mock).mockResolvedValue(undefined);
  (mailApi.markMailMessageUnread as jest.Mock).mockResolvedValue(undefined);
  (mailApi.markAllMailMessagesRead as jest.Mock).mockResolvedValue({ ok: true, changed: 1 });
  (mailApi.moveMailMessage as jest.Mock).mockResolvedValue({ ok: true });
  (mailApi.deleteMailMessage as jest.Mock).mockResolvedValue({ ok: true, message_id: 'trash-message-1', folder: 'trash' });
  (mailApi.restoreMailMessage as jest.Mock).mockResolvedValue({ ok: true, message_id: 'message-1', folder: 'inbox' });
  (mailApi.bulkMailMessageAction as jest.Mock).mockResolvedValue({ ok: true, failed: 0 });
  (mailApi.setMailConversationRead as jest.Mock).mockResolvedValue({ ok: true });
  (mailConfigApi.getNativeMailPreferences as jest.Mock).mockResolvedValue({
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: true,
    show_preview_snippets: true,
    show_favorites_first: true,
  });
  (mailApi.searchMailContacts as jest.Mock).mockResolvedValue([]);
  (mailApi.saveMailDraft as jest.Mock).mockResolvedValue({ draft_id: 'draft-1', attachments: [] });
  (mailApi.sendMailMessage as jest.Mock).mockResolvedValue({ ok: true });
  (mailApi.summarizeMailMessage as jest.Mock).mockResolvedValue({ summary: 'Короткий пересказ письма.' });
});

it('loads native mail rows and opens the exact mailbox-scoped message', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByText('План работ')).toBeTruthy());
  const row = view.getByTestId('native-mail-message-message-1');
  expect(row.props.accessibilityActions).toEqual(expect.arrayContaining([
    { name: 'longpress', label: 'Выбрать письмо' },
    { name: 'toggleRead', label: 'Отметить прочитанным' },
    { name: 'delete', label: 'Удалить письмо' },
  ]));
  expect(StyleSheet.flatten(row.props.style)).toEqual(expect.objectContaining({ backgroundColor: '#ffffff' }));
  expect(StyleSheet.flatten(row.props.style).opacity).toBeUndefined();
  fireEvent.press(row);
  expect(mailApi.markMailMessageRead).not.toHaveBeenCalled();
  expect(mailApi.markMailMessageUnread).not.toHaveBeenCalled();
  expect(mailApi.deleteMailMessage).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/mail/[messageId]',
    params: { messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox', sequence: '["message-1"]' },
  });
});

it('autosaves text and attachments once without uploading the file again on the next edit', async () => {
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1' });
    (pickMailAttachments as jest.Mock).mockResolvedValueOnce([
      { uri: 'file:///synthetic.txt', name: 'План.txt', size: 10, mimeType: 'text/plain' },
    ]);
    (mailApi.saveMailDraft as jest.Mock).mockResolvedValue({ draft_id: 'draft-1', attachments: [{ id: 'saved-file', name: 'План.txt', size: 10 }] });
    const view = await render(<NativeMailComposeScreen />);
    await waitFor(() => expect(view.getByTestId('native-mail-body')).toBeTruthy());
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Синтетический черновик');
    await fireEvent.press(view.getByTestId('native-mail-add-files'));
    for (let step = 0; step < 12; step += 1) {
      await act(async () => { jest.advanceTimersByTime(2500); });
    }
    expect(mailApi.saveMailDraft).toHaveBeenCalledTimes(1);
    expect(mailApi.saveMailDraft).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: 'План.txt' })] }));
    expect(view.getByText('Черновик сохранён')).toBeTruthy();
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Новая версия текста');
    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(mailApi.saveMailDraft).toHaveBeenCalledTimes(2);
    expect(mailApi.saveMailDraft).toHaveBeenLastCalledWith(expect.objectContaining({ files: [], retainExistingAttachments: ['saved-file'] }));
    await view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('locks the exact payload while mail is being sent', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.com', subject: 'План' });
  let finish!: (value: unknown) => void;
  (mailApi.sendMailMessage as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body')).toBeTruthy());
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Исходный текст');
  await fireEvent.press(view.getByTestId('native-mail-send'));
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1));
  expect(view.getByTestId('native-mail-body').props.editable).toBe(false);
  expect(view.getByTestId('native-mail-to').props.editable).toBe(false);
  expect(view.getByTestId('native-mail-subject').props.editable).toBe(false);
  await act(async () => { finish({ ok: true }); });
});

it('shows the inbox before optional folder metadata finishes', async () => {
  (mailApi.getMailFolderSummary as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());
});

it('keeps undo available after a definitive rejected restoration', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  (mailApi.restoreMailMessage as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Операция отклонена'), { response: { status: 409 } }));
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());
  await fireEvent(view.getByTestId('native-mail-message-message-1'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
  await waitFor(() => expect(view.getByTestId('native-mail-undo')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-mail-undo'));
  await waitFor(() => expect(view.getByText('Операция отклонена')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-mail-undo'));
  await waitFor(() => expect(mailApi.restoreMailMessage).toHaveBeenCalledTimes(2));
  expect(mailApi.restoreMailMessage).toHaveBeenLastCalledWith('trash-message-1', 'box-1', 'inbox');
});

it('uses a contrasting selection marker for an already read message', async () => {
  (mailApi.getMailMessages as jest.Mock).mockResolvedValue({ items: [{ ...message, is_read: true }], total: 1, has_more: false });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());
  await fireEvent(view.getByTestId('native-mail-message-message-1'), 'longPress');
  expect(StyleSheet.flatten(view.getByTestId('native-mail-avatar-message-1').props.style).backgroundColor).toBe('#0f6cbd');
});

it('shows the message before its folder tree finishes', async () => {
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1' });
  (mailApi.getMailFolderTree as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
  const view = await render(<NativeMailMessageScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-reader-content')).toBeTruthy());
});

it('shows a conversation before its optional preferences finish', async () => {
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1' });
  (mailConfigApi.getNativeMailPreferences as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
  const view = await render(<NativeMailConversationScreen />);
  await waitFor(() => expect(view.getByText('Проверьте обновлённый план')).toBeTruthy());
  expect(mailApi.setMailConversationRead).not.toHaveBeenCalled();
});

it('does not display or cache the previous mailbox message under a new route key', async () => {
  const writesSpy = jest.spyOn(snapshotCache, 'writeNativeEntitySnapshot');
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1' });
  let finish!: (value: unknown) => void;
  (mailApi.getMailMessage as jest.Mock)
    .mockResolvedValueOnce({ ...message, is_read: true })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeMailMessageScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-reader-content')).toBeTruthy());
  mockedParams.mockReturnValue({ messageId: 'message-2', mailboxId: 'box-2' });
  await view.rerender(<NativeMailMessageScreen />);
  await waitFor(() => expect(mailApi.getMailMessage).toHaveBeenCalledTimes(2));
  expect(view.queryByText('План работ')).toBeNull();
  await act(async () => { finish({ ...message, id: 'message-2', mailbox_id: 'box-2', subject: 'Другой ящик', is_read: true }); });
  await waitFor(() => expect(view.getByText('Другой ящик')).toBeTruthy());
  const writes = writesSpy.mock.calls.filter((call) => call[0] === 'mail-message-details');
  expect(writes.length).toBeGreaterThan(0);
  for (const call of writes) {
    const data = call[3] as typeof message;
    expect(call[2]).toBe(`${data.mailbox_id}:${data.id}`);
  }
  writesSpy.mockRestore();
});

it('keeps the newer message when an earlier refresh completes late', async () => {
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1' });
  let finish!: (value: unknown) => void;
  (mailApi.getMailMessage as jest.Mock)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ ...message, is_read: true, subject: 'Свежая версия' });
  const view = await render(<NativeMailMessageScreen />);
  await waitFor(() => expect(mailApi.getMailMessage).toHaveBeenCalledTimes(1));
  await act(async () => { view.getByTestId('native-mail-reader-scroll').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(view.getByText('Свежая версия')).toBeTruthy());
  await act(async () => { finish({ ...message, is_read: true, subject: 'Старая версия' }); });
  expect(view.queryByText('Старая версия')).toBeNull();
  expect(view.getByText('Свежая версия')).toBeTruthy();
});

it('keeps the newer conversation when an earlier refresh completes late', async () => {
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1' });
  let finish!: (value: unknown) => void;
  const detail = { conversation_id: 'thread-1', messages_count: 1, unread_count: 0, items: [{ ...message, is_read: true }] };
  (mailApi.getMailConversation as jest.Mock)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ ...detail, subject: 'Свежая цепочка' });
  const view = await render(<NativeMailConversationScreen />);
  await waitFor(() => expect(mailApi.getMailConversation).toHaveBeenCalledTimes(1));
  await act(async () => { view.getByTestId('native-mail-conversation-scroll').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(view.getAllByText('Свежая цепочка').length).toBeGreaterThan(0));
  await act(async () => { finish({ ...detail, subject: 'Старая цепочка' }); });
  expect(view.queryAllByText('Старая цепочка')).toHaveLength(0);
});

it('does not reload the whole inbox after resolving the default mailbox', async () => {
  const view = await render(<NativeMailInboxScreen />);

  await waitFor(() => expect(view.getByText('План работ')).toBeTruthy());
  await waitFor(() => expect(mailboxApi.listMailboxes).toHaveBeenCalledTimes(1));
  expect(mailApi.getMailMessages).toHaveBeenCalledTimes(1);
  expect(mailApi.getMailFolderSummary).toHaveBeenCalledTimes(1);
  expect(mailApi.getMailFolderTree).toHaveBeenCalledTimes(1);
});

it('removes a read message from the unread filter, updates counters, and restores it on undo', async () => {
  (mailboxApi.listMailboxes as jest.Mock)
    .mockResolvedValueOnce([
      { id: 'box-1', label: 'Рабочая почта', mailbox_email: 'me@example.com', is_primary: true, is_active: true, unread_count: 1 },
    ])
    .mockResolvedValueOnce([
      { id: 'box-1', label: 'Рабочая почта', mailbox_email: 'me@example.com', is_primary: true, is_active: true, unread_count: 0 },
    ]);
  mockedParams.mockReturnValue({ mailboxId: 'box-1', unreadOnly: '1' });
  const view = await render(<NativeMailInboxScreen />);
  const row = await view.findByTestId('native-mail-message-message-1');

  expect(view.getByTestId('native-mail-folder-unread-count').props.children).toBe(1);
  fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'toggleRead' } });

  await waitFor(() => expect(mailApi.markMailMessageRead).toHaveBeenCalledWith('message-1', 'box-1'));
  await waitFor(() => expect(view.queryByTestId('native-mail-message-message-1')).toBeNull());
  expect(view.queryByTestId('native-mail-folder-unread-count')).toBeNull();

  fireEvent.press(view.getByTestId('native-mail-account-menu'));
  await waitFor(() => expect(view.getByTestId('native-mail-account-sheet')).toBeTruthy());
  expect(view.queryByTestId('native-mail-account-unread-box-1')).toBeNull();

  fireEvent.press(view.getByTestId('native-mail-undo'));
  await waitFor(() => expect(mailApi.markMailMessageUnread).toHaveBeenCalledWith('message-1', 'box-1'));
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());
  expect(view.getByTestId('native-mail-folder-unread-count').props.children).toBe(1);
});

it('applies saved native list preferences without blocking the inbox', async () => {
  (mailConfigApi.getNativeMailPreferences as jest.Mock).mockResolvedValue({
    reading_pane: 'right',
    density: 'compact',
    mark_read_on_select: false,
    show_preview_snippets: false,
    show_favorites_first: true,
  });
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });

  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByText('План работ')).toBeTruthy());

  expect(view.queryByText('Проверьте обновлённый план')).toBeNull();
});

it('keeps mail settings native and omits the web fallback', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-view-menu')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-mail-view-menu'));
  await waitFor(() => expect(view.getByTestId('native-mail-settings')).toBeTruthy());
  expect(view.queryByTestId('native-mail-open-web')).toBeNull();
});

it('loads the server folder tree and opens a custom folder natively', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-folder-menu')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-mail-folder-menu'));
  await waitFor(() => expect(view.getByTestId('native-mail-folder-custom-projects')).toBeTruthy());

  fireEvent.press(view.getByTestId('native-mail-folder-custom-projects'));

  await waitFor(() => expect(mailApi.getMailMessages).toHaveBeenCalledWith(expect.objectContaining({
    mailboxId: 'box-1',
    folder: 'custom-projects',
    folderScope: 'current',
  })));
});

it('renders a compact unified header, one horizontal filter row and compose FAB', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());

  expect(view.getByTestId('native-mail-search').props.placeholder).toBe('Поиск в почте');
  expect(view.getByTestId('native-mail-filter-row').props.horizontal).toBe(true);
  expect(StyleSheet.flatten(view.getByTestId('native-mail-filter-row').props.style)).toEqual(expect.objectContaining({ flexGrow: 0, height: 48 }));
  expect(view.getByTestId('native-mail-folder-menu')).toBeTruthy();
  expect(view.getByTestId('native-mail-account-menu')).toBeTruthy();
  expect(view.queryByText('Цепочки')).toBeNull();

  fireEvent.press(view.getByTestId('native-mail-compose-fab'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/(shell)/mail/compose', params: { mode: 'new', mailboxId: 'box-1' } });
});

it('switches delegated mailboxes through the avatar account sheet', async () => {
  (mailboxApi.listMailboxes as jest.Mock).mockResolvedValue([
    { id: 'box-1', label: 'Основной ящик', mailbox_email: 'me@example.com', is_primary: true, is_active: true, unread_count: 3 },
    { id: 'box-2', label: 'Длинное имя делегированного почтового ящика', mailbox_email: 'delegate@example.com', is_active: true, unread_count: 12 },
  ]);
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-account-menu')).toBeTruthy());

  fireEvent.press(view.getByTestId('native-mail-account-menu'));
  await waitFor(() => expect(view.getByTestId('native-mail-account-sheet')).toBeTruthy());
  expect(view.getByText('delegate@example.com')).toBeTruthy();
  fireEvent.press(view.getByTestId('native-mail-account-box-2'));

  await waitFor(() => expect(mailApi.getMailMessages).toHaveBeenLastCalledWith(expect.objectContaining({
    mailboxId: 'box-2',
    folder: 'inbox',
  })));
});

it('keeps a long sender, subject and date to one line and exposes unread state', async () => {
  const longSender = 'Козловский Максим Евгеньевич Очень Длинное Подразделение';
  const longSubject = 'Очень длинная тема письма, которая не должна выталкивать дату за правую границу экрана';
  (mailApi.getMailMessages as jest.Mock).mockResolvedValue({
    items: [{ ...message, sender_display: longSender, sender_person: { display: longSender, email: 'long@example.com' }, subject: longSubject, is_read: false }],
    folder: 'inbox', limit: 50, offset: 0, total: 1, has_more: false,
  });
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  const row = await view.findByTestId('native-mail-message-message-1');

  expect(view.getByText(longSender).props.numberOfLines).toBe(1);
  expect(view.getByText(longSubject).props.numberOfLines).toBe(1);
  expect(row.props.accessibilityLabel).toContain('Непрочитанное');
});

it('distinguishes an empty folder from empty search results', async () => {
  (mailApi.getMailMessages as jest.Mock).mockResolvedValue({ items: [], folder: 'inbox', limit: 50, offset: 0, total: 0, has_more: false });
  mockedParams.mockReturnValue({ mailboxId: 'box-1', q: 'не найдено' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-search-empty')).toBeTruthy());
  expect(view.getByText('Ничего не найдено')).toBeTruthy();
});

it('shows the dedicated empty-folder state without active filters', async () => {
  (mailApi.getMailMessages as jest.Mock).mockResolvedValue({ items: [], folder: 'inbox', limit: 50, offset: 0, total: 0, has_more: false });
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-folder-empty')).toBeTruthy());
  expect(view.getByText('В папке нет писем')).toBeTruthy();
});

it('shows a skeleton while the initial page is loading', async () => {
  let resolvePage: ((value: unknown) => void) | undefined;
  (mailApi.getMailMessages as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }));
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  expect(view.getByTestId('native-mail-loading-skeleton')).toBeTruthy();
  await act(async () => { resolvePage?.({ items: [message], folder: 'inbox', limit: 50, offset: 0, total: 1, has_more: false }); });
  await view.findByTestId('native-mail-message-message-1');
});

it('shows a recoverable initial error state', async () => {
  (mailApi.getMailMessages as jest.Mock)
    .mockRejectedValue(new Error('Сеть недоступна'));
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const errorView = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(errorView.getByTestId('native-mail-error-state')).toBeTruthy(), { timeout: 2_000 });
  (mailApi.getMailMessages as jest.Mock).mockResolvedValue({ items: [message], folder: 'inbox', limit: 50, offset: 0, total: 1, has_more: false });
  await act(async () => { fireEvent.press(errorView.getByTestId('native-mail-retry')); });
  await waitFor(() => expect(errorView.getByTestId('native-mail-message-message-1')).toBeTruthy());
});

it('shows a footer while the next real page is loading', async () => {
  (mailApi.getMailMessages as jest.Mock).mockResolvedValueOnce({ items: [message], folder: 'inbox', limit: 50, offset: 0, total: 2, has_more: true });
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  const list = await view.findByTestId('native-mail-list');
  let resolveNext: ((value: unknown) => void) | undefined;
  (mailApi.getMailMessages as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));

  fireEvent(list, 'onEndReached');
  await waitFor(() => expect(view.getByTestId('native-mail-loading-footer')).toBeTruthy());
  await act(async () => { resolveNext?.({ items: [], folder: 'inbox', limit: 50, offset: 1, total: 2, has_more: false }); });
});

it('archives selected messages from the compact selection header', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  const row = await view.findByTestId('native-mail-message-message-1');
  fireEvent(row, 'onLongPress');
  await waitFor(() => expect(view.getByTestId('native-mail-selection-header')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Архивировать'));
  await waitFor(() => expect(mailApi.bulkMailMessageAction).toHaveBeenCalledWith({
    mailboxId: 'box-1', action: 'move', messageIds: ['message-1'], targetFolder: 'archive', permanent: false,
  }));
});

it('applies all backend-supported advanced filters to the native list request', async () => {
  mockedParams.mockReturnValue({
    mailboxId: 'box-1',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-25',
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Смета',
    body: 'Согласовать',
    importance: 'high',
    folderScope: 'all',
  });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-advanced-filter')).toBeTruthy());

  await waitFor(() => expect(mailApi.getMailMessages).toHaveBeenLastCalledWith(expect.objectContaining({
    mailboxId: 'box-1',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-25',
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Смета',
    body: 'Согласовать',
    importance: 'high',
    folderScope: 'all',
  })));
});

it('keeps text search scoped to the current folder when that scope is selected', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', q: 'план', folderScope: 'current' });
  await render(<NativeMailInboxScreen />);

  await waitFor(() => expect(mailApi.getMailMessages).toHaveBeenLastCalledWith(expect.objectContaining({
    mailboxId: 'box-1',
    q: 'план',
    folderScope: 'current',
  })));
});

it('shows a pending row, suppresses duplicate actions, and keeps the message after a failed delete', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  let reject!: (cause: Error) => void;
  (mailApi.deleteMailMessage as jest.Mock).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const view = await render(<NativeMailInboxScreen />);
  const row = await view.findByTestId('native-mail-message-message-1');
  const action = row.props.onAccessibilityAction;
  await act(async () => {
    action({ nativeEvent: { actionName: 'delete' } });
    action({ nativeEvent: { actionName: 'delete' } });
  });
  expect(mailApi.deleteMailMessage).toHaveBeenCalledTimes(1);
  expect(view.getByTestId('native-mail-busy-message-1')).toBeTruthy();
  expect(view.getByText('Изменяем письмо…')).toBeTruthy();
  expect(view.getByTestId('native-mail-message-message-1').props.accessibilityState.busy).toBe(true);
  expect(view.queryByTestId('native-mail-undo')).toBeNull();
  await act(async () => reject(new Error('Синтетический отказ удаления')));
  await waitFor(() => expect(view.queryByTestId('native-mail-busy-message-1')).toBeNull());
  expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy();
  expect(view.queryByTestId('native-mail-undo')).toBeNull();
  await fireEvent(view.getByTestId('native-mail-message-message-1'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
  await view.findByTestId('native-mail-undo');
  expect(mailApi.deleteMailMessage).toHaveBeenCalledTimes(2);
});

it('swipes a message to recoverable Trash and restores the exact returned id on undo', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  const row = await view.findByTestId('native-mail-message-message-1');

  fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
  await waitFor(() => expect(mailApi.deleteMailMessage).toHaveBeenCalledWith('message-1', 'box-1', false));
  const undoButton = await view.findByTestId('native-mail-undo');
  fireEvent.press(undoButton);

  await waitFor(() => expect(mailApi.restoreMailMessage).toHaveBeenCalledWith('trash-message-1', 'box-1', 'inbox'));
});

it('moves selected messages to a custom folder through the bulk endpoint', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());

  fireEvent(view.getByTestId('native-mail-message-message-1'), 'onLongPress');
  await waitFor(() => expect(view.getByLabelText('Переместить')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Переместить'));
  await waitFor(() => expect(view.getByTestId('native-mail-bulk-move-sheet')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-mail-bulk-move-target-custom-projects'));

  await waitFor(() => expect(mailApi.bulkMailMessageAction).toHaveBeenCalledWith({
    mailboxId: 'box-1',
    action: 'move',
    messageIds: ['message-1'],
    targetFolder: 'custom-projects',
    permanent: false,
  }));
});

it('permanently deletes selected messages only when the current folder is trash', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedParams.mockReturnValue({ mailboxId: 'box-1', folder: 'trash' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());

  await fireEvent(view.getByTestId('native-mail-message-message-1'), 'onLongPress');
  await fireEvent.press(view.getByLabelText('Удалить'));
  expect(alert).toHaveBeenCalledWith(
    'Удалить выбранные письма навсегда?',
    'Это действие нельзя отменить.',
    expect.any(Array),
  );
  const actions = alert.mock.calls[0]?.[2] as Array<{ text?: string; onPress?: () => void }>;
  actions.find((action) => action.text === 'Удалить')?.onPress?.();

  await waitFor(() => expect(mailApi.bulkMailMessageAction).toHaveBeenCalledWith({
    mailboxId: 'box-1',
    action: 'delete',
    messageIds: ['message-1'],
    targetFolder: '',
    permanent: true,
  }));
  alert.mockRestore();
});

it('keeps failed bulk messages selected and reports a partial backend result', async () => {
  (mailApi.bulkMailMessageAction as jest.Mock).mockResolvedValue({
    ok: false,
    failed: 1,
    errors: [{ message_id: 'message-1', detail: 'Exchange failed' }],
  });
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());

  await fireEvent(view.getByTestId('native-mail-message-message-1'), 'onLongPress');
  await fireEvent.press(view.getByLabelText('Прочитано'));

  await waitFor(() => expect(view.getByText('Не удалось применить действие к 1 письму.')).toBeTruthy());
  expect(view.getByText('Выбрано: 1')).toBeTruthy();
});

it('marks an opened message read and routes reply-all to the native composer', async () => {
  (mailApi.getMailConversation as jest.Mock).mockResolvedValueOnce({
    conversation_id: 'thread-1', subject: 'План работ', participants: ['ivan@example.com'], messages_count: 1, unread_count: 0, items: [{ ...message, is_read: true }],
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);
  await waitFor(() => expect(view.getByText('Проверьте обновлённый план')).toBeTruthy());
  await waitFor(() => expect(mailApi.markMailMessageRead).toHaveBeenCalledWith('message-1', 'box-1'));
  await waitFor(() => expect(view.getByText('0 непрочитанных')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-mail-message-file-actions'));
  await waitFor(() => expect(view.getByLabelText('Ответить всем')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Ответить всем'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/mail/compose',
    params: { mode: 'reply_all', mailboxId: 'box-1', sourceMessageId: 'message-1' },
  });
});

it('opens a previously saved message without calling Exchange while offline', async () => {
  await writeNativeEntitySnapshot('mail-message-details', 1, 'box-1:message-1', { ...message, is_read: true });
  mockOfflineMode = true;
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });

  const view = await render(<NativeMailMessageScreen />);

  await waitFor(() => expect(view.getByTestId('native-mail-reader-subject')).toHaveTextContent('План работ'));
  expect(mailApi.getMailMessage).not.toHaveBeenCalled();
  expect(view.getByText(/Копия от/)).toBeTruthy();
});

it('shows a saved message immediately while refreshing it online', async () => {
  await writeNativeEntitySnapshot('mail-message-details', 1, 'box-1:message-cached', {
    ...message,
    id: 'message-cached',
    subject: 'Сохранённый план',
    body_text: 'Текст из сохранённой копии',
    is_read: true,
  });
  (mailApi.getMailMessage as jest.Mock).mockReturnValue(new Promise(() => undefined));
  mockedParams.mockReturnValue({ messageId: 'message-cached', mailboxId: 'box-1', folder: 'inbox' });

  const view = await render(<NativeMailMessageScreen />);

  await waitFor(() => expect(view.getByTestId('native-mail-reader-subject')).toHaveTextContent('Сохранённый план'));
  expect(view.getByText('Текст из сохранённой копии')).toBeTruthy();
  expect(mailApi.getMailMessage).toHaveBeenCalledWith('message-cached', 'box-1');
});

it('opens a previously saved conversation without calling Exchange while offline', async () => {
  await writeNativeEntitySnapshot('mail-conversation-details', 1, 'box-1:inbox:thread-1', {
    conversation_id: 'thread-1',
    subject: 'План работ',
    participants: ['ivan@example.com'],
    messages_count: 1,
    unread_count: 0,
    items: [{ ...message, is_read: true }],
  });
  mockOfflineMode = true;
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });

  const view = await render(<NativeMailConversationScreen />);

  await waitFor(() => expect(view.getAllByText('План работ').length).toBeGreaterThan(0));
  expect(mailApi.getMailConversation).not.toHaveBeenCalled();
  expect(view.getByText(/Копия от/)).toBeTruthy();
});

it('shows a saved conversation immediately while refreshing it online', async () => {
  await writeNativeEntitySnapshot('mail-conversation-details', 1, 'box-1:inbox:thread-cached', {
    conversation_id: 'thread-cached',
    subject: 'Сохранённая переписка',
    participants: ['ivan@example.com'],
    messages_count: 1,
    unread_count: 0,
    items: [{ ...message, id: 'message-cached', subject: 'Сохранённая переписка', is_read: true }],
  });
  (mailApi.getMailConversation as jest.Mock).mockReturnValue(new Promise(() => undefined));
  mockedParams.mockReturnValue({ conversationId: 'thread-cached', mailboxId: 'box-1', folder: 'inbox' });

  const view = await render(<NativeMailConversationScreen />);

  await waitFor(() => expect(view.getAllByText('Сохранённая переписка').length).toBeGreaterThan(0));
  expect(mailApi.getMailConversation).toHaveBeenCalledWith('thread-cached', {
    mailboxId: 'box-1',
    folder: 'inbox',
    folderScope: 'current',
  });
});

it('rolls an opened message back to unread when automatic read fails', async () => {
  (mailApi.markMailMessageRead as jest.Mock).mockRejectedValue(new Error('Exchange unavailable'));
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });

  const view = await render(<NativeMailMessageScreen />);
  await waitFor(() => expect(view.getByText('Письмо открылось, но не отметилось прочитанным.')).toBeTruthy());
  expect(view.getByText('1 непрочитанное')).toBeTruthy();

  fireEvent.press(view.getByTestId('native-mail-message-file-actions'));
  await waitFor(() => expect(view.getByLabelText('Отметить прочитанным')).toBeTruthy());
});

it('rolls a conversation back when automatic read fails', async () => {
  (mailApi.setMailConversationRead as jest.Mock).mockRejectedValue(new Error('Exchange unavailable'));
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });

  const view = await render(<NativeMailConversationScreen />);
  await waitFor(() => expect(view.getByText('Переписка открылась, но не отметилась прочитанной.')).toBeTruthy());
  expect(view.getByLabelText('Отметить переписку прочитанной')).toBeTruthy();
});

it('renders HTML mail in an isolated WebView and moves it to any custom folder', async () => {
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    is_read: true,
    body_html: '<p>Formatted <strong>mail</strong></p><img src="https://tracker.example/pixel.png">',
    can_move: true,
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);

  await waitFor(() => expect(view.getByTestId('native-mail-html-body')).toBeTruthy());
  const webView = view.getByTestId('native-mail-html-body');
  expect(webView.props.javaScriptEnabled).toBe(true);
  expect(webView.props.scrollEnabled).toBe(false);
  expect(webView.props.injectedJavaScript).toContain('mail-height');
  expect(webView.props.domStorageEnabled).toBe(false);
  expect(webView.props.source.html).toContain("script-src 'none'");
  expect(webView.props.source.html).not.toContain('tracker.example');
  await act(async () => {
    fireEvent(webView, 'onMessage', { nativeEvent: { data: JSON.stringify({ type: 'mail-height', height: 860 }) } });
  });
  expect(StyleSheet.flatten(view.getByTestId('native-mail-html-body').props.style).height).toBe(860);

  await act(async () => {
    fireEvent(view.getByTestId('native-mail-html-body'), 'onMessage', {
      nativeEvent: { data: JSON.stringify({ type: 'mail-height', height: 30_000 }) },
    });
  });
  expect(view.getByTestId('native-mail-html-body').props.scrollEnabled).toBe(true);
  expect(StyleSheet.flatten(view.getByTestId('native-mail-html-body').props.style).height).toBeLessThan(20_000);
  expect(view.getByTestId('native-mail-long-html-hint')).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-message-file-actions'));
  });
  await waitFor(() => expect(view.getByTestId('native-mail-file-actions-sheet')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByLabelText('Переместить в другую папку'));
  });
  await waitFor(() => expect(view.getByTestId('native-mail-move-sheet')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-mail-move-target-custom-projects'));
  await waitFor(() => expect(mailApi.moveMailMessage).toHaveBeenCalledWith('message-1', 'box-1', 'custom-projects'));
});

it('opens a safe HTML link outside the isolated mail document', async () => {
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    is_read: true,
    body_html: '<p><a href="https://hubit.example/task/42">Открыть задачу</a></p>',
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);
  const webView = await view.findByTestId('native-mail-html-body');

  await act(async () => {
    fireEvent(webView, 'onMessage', {
      nativeEvent: { data: JSON.stringify({ type: 'mail-link', url: 'https://hubit.example/task/42' }) },
    });
  });

  expect(openUrl).toHaveBeenCalledWith('https://hubit.example/task/42');
  openUrl.mockRestore();
});

it('offers save all attachments and opens image attachments in the native gallery', async () => {
  const saveModule = jest.requireMock('../../mail/nativeMailAttachmentSave') as {
    saveNativeMailAttachmentsToDirectory: jest.Mock;
  };
  saveModule.saveNativeMailAttachmentsToDirectory.mockResolvedValue({
    cancelled: false,
    directoryName: 'Download',
    saved: ['photo-one.png', 'photo-two.png'],
    failed: [],
  });
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    is_read: true,
    attachments: [
      { id: 'image-1', name: 'photo-one.png', content_type: 'image/png', size: 128, inline_data_url: 'data:image/png;base64,aGVsbG8=' },
      { id: 'image-2', name: 'photo-two.png', content_type: 'image/png', size: 128, inline_data_url: 'data:image/png;base64,d29ybGQ=' },
    ],
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);

  await act(async () => { fireEvent.press(await view.findByTestId('native-mail-save-all-attachments')); });
  await waitFor(() => expect(saveModule.saveNativeMailAttachmentsToDirectory).toHaveBeenCalledWith(
    'message-1',
    'box-1',
    expect.arrayContaining([expect.objectContaining({ id: 'image-1' }), expect.objectContaining({ id: 'image-2' })]),
  ));

  fireEvent.press(view.getByLabelText('Просмотреть изображение photo-one.png'));
  expect(await view.findByTestId('native-mail-image-viewer')).toBeTruthy();
  expect(view.getByText('1 / 2')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Следующее изображение'));
  expect(await view.findByText('2 / 2')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Закрыть просмотр изображений'));
  await waitFor(() => expect(view.queryByTestId('native-mail-image-viewer')).toBeNull());
});

it('downloads a protected image on demand before showing it in the native gallery', async () => {
  const filesModule = jest.requireMock('../../mail/nativeMailFiles') as { downloadMailAttachment: jest.Mock };
  filesModule.downloadMailAttachment.mockResolvedValue({ uri: 'file:///cache/protected-photo.jpg' });
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    is_read: true,
    attachments: [{ id: 'protected-image', name: 'protected-photo.jpg', content_type: 'image/jpeg', size: 2048 }],
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);

  fireEvent.press(await view.findByLabelText('Открыть изображение protected-photo.jpg'));

  await waitFor(() => expect(filesModule.downloadMailAttachment).toHaveBeenCalledWith(
    'message-1',
    'box-1',
    expect.objectContaining({ id: 'protected-image' }),
  ));
  expect(await view.findByTestId('native-mail-image-viewer')).toBeTruthy();
  expect(view.getByLabelText('protected-photo.jpg')).toBeTruthy();
});

it('uses the same image gallery across all messages in a native conversation', async () => {
  (mailApi.getMailConversation as jest.Mock).mockResolvedValue({
    conversation_id: 'thread-1',
    subject: 'Фотоотчёт',
    participants: ['ivan@example.com'],
    messages_count: 2,
    unread_count: 0,
    items: [
      { ...message, id: 'message-1', is_read: true, attachments: [{ id: 'photo-1', name: 'one.jpg', content_type: 'image/jpeg', inline_data_url: 'data:image/jpeg;base64,b25l' }] },
      { ...message, id: 'message-2', is_read: true, attachments: [{ id: 'photo-2', name: 'two.jpg', content_type: 'image/jpeg', inline_data_url: 'data:image/jpeg;base64,dHdv' }] },
    ],
  });
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailConversationScreen />);

  await fireEvent.press(await view.findByTestId('native-mail-expand-message-1'));
  fireEvent.press(await view.findByLabelText('Просмотреть изображение one.jpg'));
  expect(await view.findByText('1 / 2')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Следующее изображение'));
  expect(await view.findByText('2 / 2')).toBeTruthy();
});

it('marks an opened native message read even when the web reading-pane preference is disabled', async () => {
  (mailConfigApi.getNativeMailPreferences as jest.Mock).mockResolvedValue({
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: false,
    show_preview_snippets: true,
    show_favorites_first: true,
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });

  const view = await render(<NativeMailMessageScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-file-actions')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-mail-message-file-actions'));
  await waitFor(() => expect(view.getByLabelText('Отметить непрочитанным')).toBeTruthy());
  expect(view.queryByTestId('native-mail-message-open-web')).toBeNull();

  await waitFor(() => expect(mailApi.markMailMessageRead).toHaveBeenCalledWith('message-1', 'box-1'));
});

it('mounts one rich body for 100 messages and replies to the explicitly expanded message', async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({
    ...message, id: `synthetic-${index}`, is_read: true,
    body_html: `<p>Synthetic body ${index}</p>`,
    attachments: [{ id: `file-${index}`, name: `synthetic-${index}.txt`, content_type: 'text/plain' }],
  }));
  (mailApi.getMailConversation as jest.Mock).mockResolvedValue({ conversation_id: 'thread-1', subject: 'Synthetic', items, messages_count: 100, unread_count: 0 });
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1' });
  const view = await render(<NativeMailConversationScreen />);
  await view.findByTestId('native-mail-expand-synthetic-99');
  expect(view.getAllByTestId('native-mail-html-body')).toHaveLength(1);
  expect(view.getAllByTestId('native-mail-attachments')).toHaveLength(1);
  expect(view.getByTestId('native-mail-expand-synthetic-99').props.accessibilityState.expanded).toBe(true);
  await fireEvent.press(view.getByTestId('native-mail-expand-synthetic-0'));
  expect(view.getAllByTestId('native-mail-html-body')).toHaveLength(1);
  expect(view.getByTestId('native-mail-expand-synthetic-99').props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(view.getByLabelText('Ответить на это письмо'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/(shell)/mail/compose', params: { mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'synthetic-0' } });
  await fireEvent.press(view.getByLabelText('Переслать это письмо'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/(shell)/mail/compose', params: { mode: 'forward', mailboxId: 'box-1', sourceMessageId: 'synthetic-0' } });
  await fireEvent.press(view.getByTestId('native-mail-expand-synthetic-0'));
  expect(view.queryAllByTestId('native-mail-html-body')).toHaveLength(0);
});

it('opens a targeted message and can reveal the first unread message', async () => {
  (mailConfigApi.getNativeMailPreferences as jest.Mock).mockResolvedValue({ mark_read_on_select: false });
  (mailApi.getMailConversation as jest.Mock).mockResolvedValue({ conversation_id: 'thread-1', subject: 'Synthetic', unread_count: 1, items: [
    { ...message, id: 'unread', is_read: false },
    { ...message, id: 'target', is_read: true },
    { ...message, id: 'latest', is_read: true },
  ] });
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', messageId: 'target' });
  const view = await render(<NativeMailConversationScreen />);
  await view.findByTestId('native-mail-expand-target');
  expect(view.getByTestId('native-mail-expand-target').props.accessibilityState.expanded).toBe(true);
  await fireEvent.press(view.getByText('К первому непрочитанному'));
  expect(view.getByTestId('native-mail-expand-unread').props.accessibilityState.expanded).toBe(true);
  expect(view.getByTestId('native-mail-expand-target').props.accessibilityState.expanded).toBe(false);
});

it('loads a conversation and replies to its latest message', async () => {
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailConversationScreen />);
  await waitFor(() => expect(view.getByText('1 сообщений · 1 участников')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Ответить'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/mail/compose',
    params: { mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-1' },
  });
});

it('expands a multiline quick reply without placing its text in route parameters', async () => {
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);
  const field = await view.findByTestId('native-mail-message-quick-reply');
  const text = 'Первая строка\nВторая строка';
  await fireEvent.changeText(field, text);
  expect(field.props.onSubmitEditing).toBeUndefined();
  await fireEvent.press(view.getByLabelText('Открыть полный редактор ответа'));
  expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/(shell)/mail/compose', params: {
    mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-1', transferId: expect.any(String),
  } });
  expect(view.getByTestId('native-mail-message-quick-reply').props.value).toBe(text);
  await view.unmount();
  const destination = jest.mocked(router.push).mock.calls.at(-1)?.[0] as { params: Record<string, string> };
  mockedParams.mockReturnValue(destination.params);
  const compose = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(compose.getByTestId('native-mail-body').props.value).toBe(text));
});

it('sends an inline formatted quick reply through the existing idempotent reply contract', async () => {
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailConversationScreen />);
  const field = await view.findByTestId('native-mail-quick-reply');
  const bar = view.getByTestId('native-mail-quick-reply-bar');
  const scroll = view.getByTestId('native-mail-conversation-scroll');
  expect(field.props.multiline).toBe(true);
  expect(field.props.submitBehavior).toBe('newline');
  expect(bar.parent).toBe(scroll.parent);
  await act(async () => { fireEvent.changeText(field, 'Согласовано, спасибо'); });
  await waitFor(() => expect(view.getByTestId('native-mail-send-quick-reply').props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(view.getByTestId('native-mail-send-quick-reply'));

  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledWith(expect.objectContaining({
    fromMailboxId: 'box-1',
    composeMode: 'reply',
    to: ['ivan@example.com'],
    subject: 'Re: План работ',
    body: expect.stringContaining('Согласовано, спасибо'),
    isHtml: true,
    replyToMessageId: 'message-1',
  }), expect.objectContaining({ idempotencyKey: expect.any(String) })));
});

it('sends a quick reply directly from a single opened message', async () => {
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);
  const field = await view.findByTestId('native-mail-message-quick-reply');
  const bar = view.getByTestId('native-mail-message-quick-reply-bar');
  const actions = view.getByTestId('native-mail-reader-bottom-actions');
  expect(field.props.multiline).toBe(true);
  expect(field.props.submitBehavior).toBe('newline');
  expect(bar.parent).toBe(actions.parent);

  await act(async () => { fireEvent.changeText(field, 'Принято, спасибо'); });
  fireEvent.press(view.getByTestId('native-mail-message-send-quick-reply'));

  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledWith(expect.objectContaining({
    fromMailboxId: 'box-1',
    composeMode: 'reply',
    to: ['ivan@example.com'],
    body: expect.stringContaining('Принято, спасибо'),
    isHtml: true,
    replyToMessageId: 'message-1',
  }), expect.objectContaining({ idempotencyKey: expect.any(String) })));
  expect(await view.findByText('Ответ отправлен')).toBeTruthy();
});

it.each(['message', 'conversation'] as const)('locks concurrent %s quick replies and permits an unchanged retry after failure', async (kind) => {
  mockedParams.mockReturnValue({ messageId: 'message-1', conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const retryAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let rejectSend!: (error: Error) => void;
  (mailApi.sendMailMessage as jest.Mock).mockImplementationOnce(() => new Promise((_, reject) => { rejectSend = reject; }));
  const view = await render(kind === 'message' ? <NativeMailMessageScreen /> : <NativeMailConversationScreen />);
  const inputId = kind === 'message' ? 'native-mail-message-quick-reply' : 'native-mail-quick-reply';
  const sendId = kind === 'message' ? 'native-mail-message-send-quick-reply' : 'native-mail-send-quick-reply';
  await fireEvent.changeText(await view.findByTestId(inputId), 'Повторяемый ответ');
  const click = view.getByTestId(sendId).props.onClick;
  const press = () => click({ nativeEvent: {}, currentTarget: 1, target: 1, stopPropagation: jest.fn() });
  // Two native callbacks can arrive before React commits the disabled state.
  await act(async () => { press(); press(); });
  expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1);
  expect(view.getByTestId(inputId).props.editable).toBe(false);
  const firstKey = (mailApi.sendMailMessage as jest.Mock).mock.calls[0][1].idempotencyKey;
  await act(async () => { rejectSend(new Error('Synthetic timeout')); });
  expect(view.getByText(/Проверьте папку «Отправленные» перед повтором/)).toBeTruthy();
  expect(view.queryByText(/Повторная попытка будет безопасной/)).toBeNull();
  expect(view.getByTestId(inputId).props.value).toBe('Повторяемый ответ');
  await fireEvent.press(view.getByTestId(sendId));
  await waitFor(() => expect(retryAlert).toHaveBeenCalledWith('Повторить отправку?', expect.any(String), expect.any(Array)));
  expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1);
  await act(async () => { retryAlert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Повторить отправку')?.onPress?.(); });
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(2));
  expect((mailApi.sendMailMessage as jest.Mock).mock.calls[1][1].idempotencyKey).toBe(firstKey);
  await waitFor(() => expect(view.getByTestId(inputId).props.value).toBe(''));
});

it.each(['message', 'conversation'] as const)('restores an uncertain %s send and requires confirmation before retrying', async (kind) => {
  mockedParams.mockReturnValue({ messageId: 'message-1', conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (mailApi.sendMailMessage as jest.Mock).mockRejectedValueOnce(new Error('Synthetic timeout'));
  const screen = () => kind === 'message' ? <NativeMailMessageScreen /> : <NativeMailConversationScreen />;
  const inputId = kind === 'message' ? 'native-mail-message-quick-reply' : 'native-mail-quick-reply';
  const sendId = kind === 'message' ? 'native-mail-message-send-quick-reply' : 'native-mail-send-quick-reply';
  const first = await render(screen());
  await fireEvent.changeText(await first.findByTestId(inputId), 'Сохранённая попытка');
  await fireEvent.press(first.getByTestId(sendId));
  await first.findByText(/Проверьте папку «Отправленные» перед повтором/);
  const key = (mailApi.sendMailMessage as jest.Mock).mock.calls[0][1].idempotencyKey;
  await first.unmount();
  const restored = await render(screen());
  await waitFor(() => expect(restored.getByTestId(inputId).props.value).toBe('Сохранённая попытка'));
  expect(restored.getByTestId(inputId).props.editable).toBe(false);
  await fireEvent.press(restored.getByLabelText('Открыть полный редактор ответа'));
  expect(router.push).not.toHaveBeenCalled();
  await fireEvent.press(restored.getByTestId(sendId));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Повторить отправку?', expect.any(String), expect.any(Array)));
  expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1);
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Повторить отправку')?.onPress?.(); });
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(2));
  expect((mailApi.sendMailMessage as jest.Mock).mock.calls[1][1].idempotencyKey).toBe(key);
  await waitFor(() => expect(restored.getByTestId(inputId).props.value).toBe(''));
});

it('does not navigate the new user away when the previous user send finishes', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.com', subject: 'Subject' });
  let finish!: (value: unknown) => void;
  (mailApi.sendMailMessage as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Old user message');
  await fireEvent.press(view.getByTestId('native-mail-send'));
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1));
  mockUserId = 2;
  await view.rerender(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body').props.value).toBe(''));
  await act(async () => { finish({ ok: true }); });
  expect(router.replace).not.toHaveBeenCalled();
});

it('does not attach a late picker result to another mailbox editor', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  let finish!: (value: Awaited<ReturnType<typeof pickMailAttachments>>) => void;
  jest.mocked(pickMailAttachments).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await fireEvent.press(view.getByTestId('native-mail-add-files'));
  mockedParams.mockReturnValue({ mailboxId: 'box-2' });
  await view.rerender(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await act(async () => { finish([{ uri: 'file:///synthetic-old', name: 'Previous mailbox.txt', size: 1, mimeType: 'text/plain' }]); });
  expect(view.queryByText('Previous mailbox.txt')).toBeNull();
});

it('reconciles the inbox instead of repeating restoration after a lost response', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  (mailApi.restoreMailMessage as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
  const view = await render(<NativeMailInboxScreen />);
  const row = await view.findByTestId('native-mail-message-message-1');
  await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
  const undoButton = await view.findByTestId('native-mail-undo');
  const calls = (mailApi.getMailMessages as jest.Mock).mock.calls.length;
  await fireEvent.press(undoButton);
  await waitFor(() => expect((mailApi.getMailMessages as jest.Mock).mock.calls.length).toBeGreaterThan(calls));
  expect(view.queryByTestId('native-mail-undo')).toBeNull();
  expect(mailApi.restoreMailMessage).toHaveBeenCalledTimes(1);
  expect(view.getByText(/Результат отмены не подтверждён/)).toBeTruthy();
});

it('reconciles a deletion with a lost response without issuing a second mutation', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  const row = await view.findByTestId('native-mail-message-message-1');
  (mailApi.getMailMessages as jest.Mock).mockResolvedValue({ items: [], total: 0, has_more: false });
  (mailApi.deleteMailMessage as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
  await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
  await waitFor(() => expect(view.queryByTestId('native-mail-message-message-1')).toBeNull());
  expect(mailApi.deleteMailMessage).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId('native-mail-undo')).toBeNull();
  expect(view.getByText(/Результат действия не подтверждён/)).toBeTruthy();
});

it.each(['message', 'conversation'] as const)('protects an unsaved %s quick reply on Back', async (kind) => {
  const store = jest.spyOn(quickReplyDraftStore, 'createMailQuickReplyDraftSession').mockReturnValue({ ...createMailQuickReplyDraftSession({ userId: 1, mailboxId: 'box-1', kind, entityId: 'synthetic' }), read: async () => '', write: async () => { throw new Error('Synthetic write failure'); }, clearIfText: async () => {} });
  const alert = jest.spyOn(Alert, 'alert');
  mockedParams.mockReturnValue({ messageId: 'message-1', conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(kind === 'message' ? <NativeMailMessageScreen /> : <NativeMailConversationScreen />);
  const inputId = kind === 'message' ? 'native-mail-message-quick-reply' : 'native-mail-quick-reply';
  await fireEvent.changeText(await view.findByTestId(inputId), 'Ответ ещё не отправлен');
  jest.mocked(router.back).mockClear();
  await fireEvent.press(view.getByLabelText('Назад'));
  expect(router.back).not.toHaveBeenCalled();
  expect(alert).toHaveBeenLastCalledWith('Выйти без сохранения?', expect.any(String), expect.any(Array), expect.any(Object));
  const buttons = alert.mock.calls.at(-1)![2]!;
  await act(async () => { buttons.find((button) => button.text === 'Остаться')!.onPress!(); });
  expect(view.getByTestId(inputId).props.value).toBe('Ответ ещё не отправлен');
  await fireEvent.press(view.getByLabelText('Назад'));
  await act(async () => { alert.mock.calls.at(-1)![2]!.find((button) => button.text === 'Выйти')!.onPress!(); });
  expect(router.back).toHaveBeenCalledTimes(1);
  alert.mockRestore();
  store.mockRestore();
});

it('does not navigate a new screen when an unmounted composer finishes sending', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.com', subject: 'План' });
  let finish!: (value: unknown) => void;
  (mailApi.sendMailMessage as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const old = await render(<NativeMailComposeScreen />);
  await fireEvent.changeText(await old.findByTestId('native-mail-body'), 'Старая отправка');
  await fireEvent.press(old.getByTestId('native-mail-send'));
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1));
  await old.unmount();
  const current = await render(<NativeMailComposeScreen />);
  await fireEvent.changeText(await current.findByTestId('native-mail-body'), 'Новый черновик');
  jest.mocked(router.replace).mockClear();
  await act(async () => { finish({ ok: true }); });
  expect(router.replace).not.toHaveBeenCalled();
  expect(current.getByTestId('native-mail-body').props.value).toBe('Новый черновик');
});

it.each(['message', 'conversation'] as const)('restores the persisted %s quick reply on a new screen instance', async (kind) => {
  mockedParams.mockReturnValue({ messageId: 'message-1', conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const screen = () => kind === 'message' ? <NativeMailMessageScreen /> : <NativeMailConversationScreen />;
  const inputId = kind === 'message' ? 'native-mail-message-quick-reply' : 'native-mail-quick-reply';
  const old = await render(screen());
  await fireEvent.changeText(await old.findByTestId(inputId), 'Черновик\nпосле открытия');
  const session = createMailQuickReplyDraftSession({ userId: 1, mailboxId: 'box-1', kind, entityId: kind === 'message' ? 'message-1' : 'thread-1' });
  expect(await session.read()).toBe('Черновик\nпосле открытия');
  await old.unmount();
  const current = await render(screen());
  await waitFor(() => expect(current.getByTestId(inputId).props.value).toBe('Черновик\nпосле открытия'));
});

it('keeps the conversation quick reply inside the shared keyboard host', async () => {
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailConversationScreen />);
  expect(await view.findByTestId('native-mail-conversation-keyboard-host')).toBeTruthy();
});

it('keeps the single-message quick reply inside the shared keyboard host', async () => {
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox', sequence: '["message-1"]' });
  const view = await render(<NativeMailMessageScreen />);
  expect(await view.findByTestId('native-mail-message-keyboard-host')).toBeTruthy();
});

it('loads raw message headers from the existing authenticated endpoint', async () => {
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);
  await view.findByTestId('native-mail-message-file-actions');
  await act(async () => { fireEvent.press(view.getByTestId('native-mail-message-file-actions')); });
  await view.findByTestId('native-mail-file-actions-sheet');
  fireEvent.press(view.getByLabelText('Заголовки письма'));

  await waitFor(() => expect(mailApi.getMailMessageHeaders).toHaveBeenCalledWith('message-1', 'box-1'));
  const sheet = await view.findByTestId('native-mail-headers-sheet');
  expect(within(sheet).getByText('ivan@example.com')).toBeTruthy();
});

it('uses a flat reader hierarchy and reveals long recipient details on demand', async () => {
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    subject: 'Очень длинная тема письма, которая должна занимать не больше двух строк на узком экране',
    cc: ['copy@example.com'],
    cc_people: [{ display: 'Копия Получатель', email: 'copy@example.com' }],
    bcc: ['hidden@example.com'],
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);

  const subject = await view.findByTestId('native-mail-reader-subject');
  expect(subject.props.numberOfLines).toBeUndefined();
  expect(view.getByTestId('native-mail-reader-content')).toBeTruthy();
  expect(view.getByTestId('native-mail-reader-bottom-actions')).toBeTruthy();
  expect(view.getByTestId('native-mail-recipient-count').props.children).toBe(3);
  expect(view.queryByLabelText('Переместить в архив')).toBeNull();

  await act(async () => { fireEvent.press(view.getByTestId('native-mail-recipient-details')); });
  const details = await view.findByTestId('native-mail-recipient-details-expanded');
  expect(within(details).getByText('Копия Получатель <copy@example.com>')).toBeTruthy();
  expect(within(details).getByText('hidden@example.com')).toBeTruthy();
  expect(view.getByTestId('native-mail-recipient-details').props.accessibilityState.expanded).toBe(true);
});

it('counts one recipient once when Exchange returns both person metadata and a formatted fallback address', async () => {
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    to: ['Legacy display <recipient@example.com>'],
    to_people: [{ display: 'Получатель', email: 'recipient@example.com' }],
    cc: [],
    cc_people: [],
    bcc: [],
    bcc_people: [],
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);

  expect((await view.findByTestId('native-mail-recipient-count')).props.children).toBe(1);
});

it('shows image attachments in the letter and gives files type-specific accessible actions', async () => {
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    attachments: [
      {
        id: 'image-1',
        name: 'photo.png',
        content_type: 'image/png',
        size: 2048,
        inline_data_url: 'data:image/png;base64,aGVsbG8=',
      },
      { id: 'pdf-1', name: 'report.pdf', content_type: 'application/pdf', size: 4096 },
    ],
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);

  expect(await view.findByTestId('native-mail-attachment-image-0')).toBeTruthy();
  expect(view.getByLabelText('Просмотреть изображение photo.png')).toBeTruthy();
  expect(view.getByLabelText('Открыть pdf report.pdf')).toBeTruthy();
  expect(view.getByText('Изображение · 2 КБ')).toBeTruthy();
  expect(view.getByText('PDF · 4 КБ')).toBeTruthy();

  const attachmentSection = view.getByTestId('native-mail-attachments');
  const plainBody = view.getByTestId('native-mail-plain-body');
  expect(attachmentSection.parent).toBe(plainBody.parent);
  expect(attachmentSection.parent?.children.indexOf(attachmentSection)).toBeLessThan(
    plainBody.parent?.children.indexOf(plainBody) ?? -1,
  );
});

it('opens a mail attachment with the MIME inferred from its filename', async () => {
  const downloaded = { uri: 'file:///cache/contract.docx', type: 'application/octet-stream' };
  const filesModule = jest.requireMock('../../mail/nativeMailFiles') as { downloadMailAttachment: jest.Mock };
  const downloadsModule = jest.requireMock('../../files/nativeAttachmentDownloads') as { openNativeFile: jest.Mock };
  filesModule.downloadMailAttachment.mockResolvedValue(downloaded);
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    is_read: true,
    attachments: [{ id: 'doc-1', name: 'contract.docx', content_type: 'application/zip', size: 4096 }],
  });
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);

  await act(async () => {
    fireEvent.press(await view.findByLabelText('Открыть word contract.docx'));
  });

  await waitFor(() => expect(downloadsModule.openNativeFile).toHaveBeenCalledWith(
    downloaded,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ));
});

it('keeps the fixed reader actions touch-safe', async () => {
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);
  const reply = await view.findByTestId('native-mail-reply');
  const style = StyleSheet.flatten(reply.props.style);
  expect(style.minHeight).toBe(57);
  expect(style.alignItems).toBe('center');
});

it('loads the existing AI summary inside the native reader', async () => {
  mockedParams.mockReturnValue({ messageId: 'message-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailMessageScreen />);
  await view.findByTestId('native-mail-summarize');

  fireEvent.press(view.getByTestId('native-mail-summarize'));

  await waitFor(() => expect(mailApi.summarizeMailMessage).toHaveBeenCalledWith('message-1', 'box-1'));
  expect(await view.findByText('Короткий пересказ письма.')).toBeTruthy();
});

it('moves to the next loaded inbox message from the reference-style top navigation', async () => {
  mockedParams.mockReturnValue({
    messageId: 'message-1',
    mailboxId: 'box-1',
    folder: 'inbox',
    sequence: '["message-0","message-1","message-2"]',
  });
  const view = await render(<NativeMailMessageScreen />);
  await view.findByTestId('native-mail-next-message');

  fireEvent.press(view.getByTestId('native-mail-next-message'));

  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/(shell)/mail/[messageId]',
    params: {
      messageId: 'message-2',
      mailboxId: 'box-1',
      folder: 'inbox',
      sequence: '["message-0","message-1","message-2"]',
    },
  });
});

it('explicitly toggles a loaded conversation back to unread', async () => {
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailConversationScreen />);
  await waitFor(() => expect(view.getByLabelText('Отметить переписку непрочитанной')).toBeTruthy());

  await fireEvent.press(view.getByTestId('native-mail-conversation-toggle-read'));

  await waitFor(() => expect(mailApi.setMailConversationRead).toHaveBeenLastCalledWith('thread-1', false, {
    mailboxId: 'box-1',
    folder: 'inbox',
    folderScope: 'current',
  }));
  await waitFor(() => expect(view.getByLabelText('Отметить переписку прочитанной')).toBeTruthy());
});

it('validates and sends a new message through multipart idempotent mail API', async () => {
  mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1', to: 'user@example.com' });
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body')).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(view.getByTestId('native-mail-subject'), 'Новая тема');
    fireEvent.changeText(view.getByTestId('native-mail-body'), 'Текст письма');
  });
  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-send'));
  });
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      fromMailboxId: 'box-1',
      to: ['user@example.com'],
      subject: 'Новая тема',
      body: 'Текст письма',
      isHtml: false,
    }),
    expect.objectContaining({ idempotencyKey: expect.any(String) }),
  ));
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/(shell)/mail', params: { mailboxId: 'box-1', folder: 'sent' } });
});

it('offers a valid external address even when Exchange returns no contact', async () => {
  mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1' });
  const view = await render(<NativeMailComposeScreen />);
  const toField = await view.findByTestId('native-mail-to');

  await act(async () => { fireEvent.changeText(toField, 'outside@example.net'); });
  const suggestion = await view.findByLabelText('Использовать outside@example.net');
  await act(async () => { fireEvent.press(suggestion); });

  await waitFor(() => expect(view.getByLabelText('Изменить адрес outside@example.net')).toBeTruthy());
  expect(view.getByTestId('native-mail-to').props.value).toBe('');
});

it('reinitializes recipients when the same source switches from reply to reply all', async () => {
  mockedParams.mockReturnValue({ mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-1' });
  const view = await render(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  mockedParams.mockReturnValue({ mode: 'reply_all', mailboxId: 'box-1', sourceMessageId: 'message-1' });
  await view.rerender(<NativeMailComposeScreen />);
  expect(await view.findByLabelText('Изменить адрес copy@example.com')).toBeTruthy();
});

it.each(['Остаться', 'Изменить режим'])('protects edited text on a mode change: %s', async (choice) => {
  const alert = jest.spyOn(Alert, 'alert');
  mockedParams.mockReturnValue({ mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-1' });
  const view = await render(<NativeMailComposeScreen />);
  await fireEvent.changeText(await view.findByTestId('native-mail-body'), 'Не терять этот текст');
  mockedParams.mockReturnValue({ mode: 'reply_all', mailboxId: 'box-1', sourceMessageId: 'message-1' });
  await view.rerender(<NativeMailComposeScreen />);
  expect(view.getByTestId('native-mail-body').props.value).toBe('Не терять этот текст');
  expect(alert).toHaveBeenLastCalledWith('Изменить режим письма?', expect.any(String), expect.any(Array), expect.any(Object));
  await act(async () => { alert.mock.calls.at(-1)![2]!.find((button) => button.text === choice)!.onPress!(); });
  if (choice === 'Остаться') {
    expect(view.getByTestId('native-mail-body').props.value).toBe('Не терять этот текст');
    expect(router.setParams).toHaveBeenCalledWith({ mode: 'reply' });
  } else {
    expect(await view.findByLabelText('Изменить адрес copy@example.com')).toBeTruthy();
    expect(view.getByTestId('native-mail-body').props.value).not.toBe('Не терять этот текст');
  }
  alert.mockRestore();
});

it('keeps the original HTML out of the editable reply and appends it as a formatted quote', async () => {
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    body_html: '<html><body><p><strong>Исходный форматированный текст</strong></p></body></html>',
    compose_context: {
      ...message.compose_context,
      reply: {
        subject: 'Re: План работ',
        to: ['ivan@example.com'],
        cc: [],
        quote_html: '<div class="quoted-mail"><blockquote><strong>Исходный форматированный текст</strong></blockquote></div>',
      },
    },
  });
  mockedParams.mockReturnValue({ mode: 'reply', mailboxId: 'box-1', sourceMessageId: 'message-1' });
  const view = await render(<NativeMailComposeScreen />);
  const body = await view.findByTestId('native-mail-body');

  expect(body.props.value).toBe('');
  expect(String(body.props.value)).not.toContain('<html>');
  fireEvent.press(view.getByTestId('native-mail-quote-toggle'));
  expect(await view.findByTestId('native-mail-quote-preview')).toBeTruthy();
  await act(async () => { fireEvent.changeText(body, 'Мой новый ответ'); });
  fireEvent.press(view.getByTestId('native-mail-send'));

  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledWith(expect.objectContaining({
    body: expect.stringContaining('Мой новый ответ'),
    isHtml: true,
    replyToMessageId: 'message-1',
  }), expect.any(Object)));
  const outgoingBody = (mailApi.sendMailMessage as jest.Mock).mock.calls[0][0].body;
  expect(outgoingBody).toContain('data-mail-quoted-history="true"');
  expect(outgoingBody).toContain('<strong>Исходный форматированный текст</strong>');
});

it('warns before sending when the text mentions a missing attachment', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1', to: 'user@example.com' });
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body')).toBeTruthy());
  await fireEvent.changeText(view.getByTestId('native-mail-subject'), 'Отчёт');
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Прикрепляю файл с отчётом');
  await fireEvent.press(view.getByTestId('native-mail-send'));

  expect(alert).toHaveBeenCalledWith(
    'Проверьте вложение',
    'В тексте упомянуто вложение, но файлы не прикреплены.',
    expect.any(Array),
  );
  expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
  const actions = alert.mock.calls[0]?.[2] as Array<{ text?: string; onPress?: () => void }>;
  actions.find((action) => action.text === 'Отправить без файла')?.onPress?.();
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1));
  alert.mockRestore();
});

it('opens a formatted draft in the isolated native rich editor', async () => {
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    id: 'draft-rich',
    folder: 'drafts',
    body_html: '<p><strong>Форматированный текст</strong></p>',
    body_text: 'Форматированный текст',
    draft_context: { compose_mode: 'draft' },
  });
  mockedParams.mockReturnValue({ mode: 'draft', mailboxId: 'box-1', draftId: 'draft-rich' });
  const view = await render(<NativeMailComposeScreen />);

  await waitFor(() => expect(view.getByTestId('native-mail-rich-editor')).toBeTruthy());
  expect(view.queryByTestId('native-mail-body')).toBeNull();
  expect(mailApi.saveMailDraft).not.toHaveBeenCalled();
  expect(view.queryByTestId('native-mail-rich-draft-open-web')).toBeNull();
});

it('removes an existing draft attachment from the retained token list', async () => {
  (mailApi.getMailMessage as jest.Mock).mockResolvedValue({
    ...message,
    id: 'draft-plain',
    folder: 'drafts',
    body_html: '',
    body_text: 'Черновик без форматирования',
    attachments: [{ id: 'attachment-1', download_token: 'token-1', name: 'plan.pdf', size: 1024 }],
    draft_context: { compose_mode: 'draft' },
  });
  mockedParams.mockReturnValue({ mode: 'draft', mailboxId: 'box-1', draftId: 'draft-plain' });
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByLabelText('Удалить вложение plan.pdf')).toBeTruthy());

  await fireEvent.press(view.getByLabelText('Удалить вложение plan.pdf'));
  await fireEvent.press(view.getByTestId('native-mail-compose-more'));
  await fireEvent.press(view.getByTestId('native-mail-save-draft'));

  await waitFor(() => expect(mailApi.saveMailDraft).toHaveBeenCalledWith(expect.objectContaining({
    draftId: 'draft-plain',
    retainExistingAttachments: [],
  })));
});

it('reuses the same idempotency key when a timed-out send is retried unchanged', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (mailApi.sendMailMessage as jest.Mock)
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({ ok: true });
  mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1', to: 'user@example.com' });
  const view = await render(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body')).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(view.getByTestId('native-mail-subject'), 'Retry-safe subject');
    fireEvent.changeText(view.getByTestId('native-mail-body'), 'Retry-safe body');
  });
  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-send'));
  });
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(view.getByTestId('native-mail-send').props.accessibilityState?.disabled).toBe(false));

  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-send'));
  });
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1);
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Повторить отправку')?.onPress?.(); });
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(2));

  const firstKey = (mailApi.sendMailMessage as jest.Mock).mock.calls[0][1].idempotencyKey;
  const retryKey = (mailApi.sendMailMessage as jest.Mock).mock.calls[1][1].idempotencyKey;
  expect(firstKey).toBeTruthy();
  expect(retryKey).toBe(firstKey);
  alert.mockRestore();
});

it('does not load protected mail data without mail.access', async () => {
  mockPermissions = [];
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(mailApi.getMailMessages).not.toHaveBeenCalled();
});

 it('keeps successfully loaded messages usable when folder counters fail', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  (mailApi.getMailFolderSummary as jest.Mock).mockRejectedValue(new Error('summary unavailable'));
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-message-message-1')).toBeTruthy());
  expect(view.getByText('Не обновлены счётчики папок.')).toBeTruthy();
  await fireEvent.press(view.getByTestId('native-mail-message-message-1'));
  expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/(shell)/mail/[messageId]' }));
});

it.each(['read', 'move'] as const)('applies %s to messages of selected conversations in the current folder', async (action) => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', view: 'conversations' });
  (mailApi.getMailConversations as jest.Mock).mockResolvedValue({ items: [{ conversation_id: 'thread-1', subject: 'План работ', unread_count: 1, messages_count: 1 }], has_more: false });
  const view = await render(<NativeMailInboxScreen />);
  await fireEvent(await view.findByTestId('native-mail-conversation-thread-1'), 'onLongPress');
  expect(view.getByText('Действия применяются к найденным письмам выбранных цепочек в текущей папке.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText(action === 'read' ? 'Прочитано' : 'Архивировать'));
  await waitFor(() => expect(mailApi.bulkMailMessageAction).toHaveBeenCalledWith({ mailboxId: 'box-1', action, messageIds: ['message-1'], targetFolder: action === 'move' ? 'archive' : '', permanent: false }));
  expect(mailApi.getMailConversation).toHaveBeenCalledWith('thread-1', { mailboxId: 'box-1', folder: 'inbox', folderScope: 'current' });
});

it('does not apply a bulk action when selected conversation messages cannot be loaded', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', view: 'conversations' });
  (mailApi.getMailConversations as jest.Mock).mockResolvedValue({ items: [{ conversation_id: 'thread-1', subject: 'План работ', unread_count: 1 }], has_more: false });
  (mailApi.getMailConversation as jest.Mock).mockRejectedValue(new Error('Synthetic network failure'));
  const view = await render(<NativeMailInboxScreen />);
  await fireEvent(await view.findByTestId('native-mail-conversation-thread-1'), 'onLongPress');
  await fireEvent.press(view.getByLabelText('Прочитано'));
  await waitFor(() => expect(mailApi.getMailConversation).toHaveBeenCalled());
  expect(mailApi.bulkMailMessageAction).not.toHaveBeenCalled();
  expect(view.getByText('Выбрано: 1')).toBeTruthy();
});

it('keeps the conversation selected and reports a partial bulk failure', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', view: 'conversations' });
  (mailApi.getMailConversations as jest.Mock).mockResolvedValue({ items: [{ conversation_id: 'thread-1', subject: 'План работ', unread_count: 1 }], has_more: false });
  (mailApi.bulkMailMessageAction as jest.Mock).mockResolvedValue({ ok: false, failed: 1, errors: [{ message_id: 'message-1' }] });
  const view = await render(<NativeMailInboxScreen />);
  await fireEvent(await view.findByTestId('native-mail-conversation-thread-1'), 'onLongPress');
  await fireEvent.press(view.getByLabelText('Прочитано'));
  await view.findByText('Не удалось применить действие к 1 письму.');
  expect(view.getByText('Выбрано: 1')).toBeTruthy();
  expect(view.getByTestId('native-mail-conversation-thread-1').props.accessibilityState.selected).toBe(true);
});

it.each([false, undefined])('does not modify an unverified conversation (complete=%s)', async (complete) => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', view: 'conversations' });
  (mailApi.getMailConversations as jest.Mock).mockResolvedValue({ items: [{ conversation_id: 'thread-1', subject: 'План работ', unread_count: 1 }], has_more: false });
  (mailApi.getMailConversation as jest.Mock).mockResolvedValue({ conversation_id: 'thread-1', conversation_complete: complete, items: [message] });
  const view = await render(<NativeMailInboxScreen />);
  await fireEvent(await view.findByTestId('native-mail-conversation-thread-1'), 'onLongPress');
  await fireEvent.press(view.getByLabelText('Прочитано'));
  await view.findByText('Не удалось получить цепочку целиком. Действие не выполнено. Повторите позже или выберите отдельные письма.');
  expect(mailApi.bulkMailMessageAction).not.toHaveBeenCalled();
  expect(view.getByText('Выбрано: 1')).toBeTruthy();
});

it('does not start bulk after leaving and returning to the same folder during detail loading', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', view: 'conversations' });
  (mailApi.getMailConversations as jest.Mock).mockResolvedValue({ items: [{ conversation_id: 'thread-1', subject: 'План работ', unread_count: 1 }], has_more: false });
  let finish!: (value: unknown) => void;
  (mailApi.getMailConversation as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeMailInboxScreen />);
  await fireEvent(await view.findByTestId('native-mail-conversation-thread-1'), 'onLongPress');
  await fireEvent.press(view.getByLabelText('Прочитано'));
  await waitFor(() => expect(mailApi.getMailConversation).toHaveBeenCalled());
  await fireEvent.press(view.getByLabelText('Отменить выбор'));
  for (const folder of ['custom-projects', 'inbox']) {
    await fireEvent.press(view.getByTestId('native-mail-folder-menu'));
    await fireEvent.press(await view.findByTestId(`native-mail-folder-${folder}`));
  }
  await act(async () => { finish({ conversation_complete: true, items: [message] }); });
  expect(mailApi.bulkMailMessageAction).not.toHaveBeenCalled();
});

it('ignores deletion confirmation after clearing the selection', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const alert = jest.spyOn(Alert, 'alert');
  try {
    const view = await render(<NativeMailInboxScreen />);
    await fireEvent(await view.findByTestId('native-mail-message-message-1'), 'onLongPress');
    await fireEvent.press(view.getByLabelText('Удалить'));
    const confirm = alert.mock.calls[0][2]?.[1].onPress;
    await fireEvent.press(view.getByLabelText('Отменить выбор'));
    await act(async () => { confirm?.(); });
    expect(mailApi.bulkMailMessageAction).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

it('does not send an older version from a pending attachment confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1', to: 'user@example.com' });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await fireEvent.changeText(view.getByTestId('native-mail-subject'), 'Отчёт');
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Прикрепляю файл с отчётом');
    await fireEvent.press(view.getByTestId('native-mail-send'));
    const confirm = alert.mock.calls[0][2]?.find((action) => action.text === 'Отправить без файла')?.onPress;
    expect(confirm).toBeDefined();
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Новая версия письма');
    await act(async () => { confirm?.(); });
    expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
    expect(view.getByTestId('native-mail-body').props.value).toBe('Новая версия письма');
    expect(view.getByText('Письмо изменилось. Повторите действие для текущей версии.')).toBeTruthy();
  } finally { alert.mockRestore(); }
});

it.each(['Закрыть без изменений', 'Сохранить и закрыть'])('does not act on an old close confirmation: %s', async (label) => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1' });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Первая версия');
    await fireEvent.press(view.getByLabelText('Назад'));
    const confirm = alert.mock.calls[0][2]?.find((action) => action.text === label)?.onPress;
    expect(confirm).toBeDefined();
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Новая версия');
    await act(async () => { confirm?.(); });
    expect(mailApi.saveMailDraft).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(view.getByTestId('native-mail-body').props.value).toBe('Новая версия');
  } finally { alert.mockRestore(); }
});

it('autosaves an attachment-only change once and preserves it for manual retry after failure', async () => {
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1' });
    (pickMailAttachments as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///synthetic.txt', name: 'Файл.txt', size: 10, mimeType: 'text/plain' }]);
    (mailApi.saveMailDraft as jest.Mock).mockRejectedValueOnce(new Error('Не удалось сохранить черновик.'))
      .mockResolvedValue({ draft_id: 'draft-1', attachments: [{ id: 'saved', name: 'Файл.txt', size: 10 }] });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await fireEvent.press(view.getByTestId('native-mail-add-files'));
    for (let step = 0; step < 5; step += 1) await act(async () => { jest.advanceTimersByTime(2500); });
    expect(mailApi.saveMailDraft).toHaveBeenCalledTimes(1);
    expect(view.getByText('Файл.txt')).toBeTruthy();
    await fireEvent.press(view.getByTestId('native-mail-compose-more'));
    await fireEvent.press(view.getByTestId('native-mail-save-draft'));
    expect(mailApi.saveMailDraft).toHaveBeenCalledTimes(2);
    expect(view.getByText('Черновик сохранён')).toBeTruthy();
    await view.unmount();
  } finally { jest.useRealTimers(); }
});

it.each([true, false])('reconciles missing attachment ACK without silently dropping the local file: %s', async (confirmed) => {
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1' });
    (pickMailAttachments as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///synthetic.txt', name: 'Подтверждение.txt', size: 10, mimeType: 'text/plain' }]);
    (mailApi.saveMailDraft as jest.Mock).mockResolvedValue({ draft_id: 'draft-1' });
    (mailApi.getMailMessage as jest.Mock).mockResolvedValue({ ...message, id: 'draft-1', attachments: confirmed ? [{ id: 'saved', name: 'Подтверждение.txt', size: 10 }] : [] });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await fireEvent.press(view.getByTestId('native-mail-add-files'));
    for (let step = 0; step < 4; step += 1) await act(async () => { jest.advanceTimersByTime(2500); });
    expect(mailApi.saveMailDraft).toHaveBeenCalledTimes(1);
    expect(mailApi.getMailMessage).toHaveBeenCalledWith('draft-1', 'box-1');
    expect(view.getByText('Подтверждение.txt')).toBeTruthy();
    if (confirmed) expect(view.getByText('Черновик сохранён')).toBeTruthy();
    else {
      expect(view.queryByText('Черновик сохранён')).toBeNull();
      expect(view.getByText('Сохранение вложений не подтверждено. Файлы оставлены в редакторе; проверьте серверный черновик перед повтором.')).toBeTruthy();
    }
    await view.unmount();
  } finally { jest.useRealTimers(); }
});

it('restores a locally saved full compose body after unmount and reopening', async () => {
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1', mode: 'new' });
    const first = await render(<NativeMailComposeScreen />);
    await first.findByTestId('native-mail-body');
    await fireEvent.changeText(first.getByTestId('native-mail-body'), 'Локальная версия до серверного сохранения');
    await fireEvent.changeText(first.getByTestId('native-mail-subject'), 'Локальная тема');
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(mailApi.saveMailDraft).not.toHaveBeenCalled();
    await first.unmount();
    const second = await render(<NativeMailComposeScreen />);
    await waitFor(() => expect(second.getByTestId('native-mail-body').props.value).toBe('Локальная версия до серверного сохранения'));
    expect(second.getByTestId('native-mail-subject').props.value).toBe('Локальная тема');
    await second.unmount();
  } finally { jest.useRealTimers(); }
});

it.each(['offline', 'network-error'] as const)('opens a local full draft when bootstrap is unavailable: %s', async (failure) => {
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1', mode: 'new' });
    const first = await render(<NativeMailComposeScreen />);
    await first.findByTestId('native-mail-body');
    await fireEvent.changeText(first.getByTestId('native-mail-body'), 'Доступно без сети');
    await act(async () => { jest.advanceTimersByTime(400); });
    await first.unmount();
    (mailboxApi.listMailboxes as jest.Mock).mockClear().mockRejectedValue(new Error('Synthetic offline'));
    mockOfflineMode = failure === 'offline';
    const second = await render(<NativeMailComposeScreen />);
    await waitFor(() => expect(second.getByTestId('native-mail-body').props.value).toBe('Доступно без сети'));
    if (failure === 'offline') expect(mailboxApi.listMailboxes).not.toHaveBeenCalled();
    expect(mailApi.saveMailDraft).not.toHaveBeenCalled();
    await fireEvent.changeText(second.getByTestId('native-mail-body'), 'Правка после восстановления');
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(second.getByText('Сохранено на устройстве')).toBeTruthy();
    await second.unmount();
  } finally { jest.useRealTimers(); }
});

it('keeps the editor writable after local discard fails and retries closing', async () => {
  await clearMailComposeDrafts();
  jest.useFakeTimers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1' });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await act(async () => { jest.advanceTimersByTime(0); });
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'До ошибки');
    await act(async () => { jest.advanceTimersByTime(400); });
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Synthetic failure'));
    await fireEvent.press(view.getByLabelText('Назад'));
    await act(async () => { alert.mock.calls.at(-1)?.[2]?.find((action) => action.text === 'Закрыть без изменений')?.onPress?.(); });
    expect(view.getByText('Не удалось удалить локальный черновик. Повторите закрытие.')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'После ошибки');
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(view.getByText('Сохранено на устройстве')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Назад'));
    await act(async () => { alert.mock.calls.at(-1)?.[2]?.find((action) => action.text === 'Закрыть без изменений')?.onPress?.(); });
    expect((router.back as jest.Mock).mock.calls.length + (router.replace as jest.Mock).mock.calls.length).toBe(1);
    await view.unmount();
  } finally { alert.mockRestore(); jest.useRealTimers(); }
});

it('uploads the durable local attachment after Android removes the picker file', async () => {
  const uuid = jest.spyOn(jest.requireMock('expo-crypto'), 'randomUUID').mockReturnValue('synthetic-durable-mail-file');
  await clearMailComposeDrafts();
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1', mode: 'new' });
    const source = new File(Paths.cache, 'synthetic-mail-upload.txt');
    source.write('Синтетическое вложение');
    (pickMailAttachments as jest.Mock).mockResolvedValueOnce([{ uri: source.uri, name: 'Документ.txt', size: source.size, mimeType: 'text/plain' }]);
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await act(async () => { jest.advanceTimersByTime(0); });
    await fireEvent.press(view.getByTestId('native-mail-add-files'));
    await act(async () => { jest.advanceTimersByTime(400); });
    await act(async () => { jest.advanceTimersByTime(400); });
    const stored = JSON.parse((await SecureStore.getItemAsync('hubit_mail_compose_drafts_v1')) || '[]');
    expect(stored[0]?.state.files[0]?.uri).toContain('hubit-mail-compose-files');
    source.delete();
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'После очистки временного файла');
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(view.getByText('Сохранено на устройстве')).toBeTruthy();
    await fireEvent.press(view.getByTestId('native-mail-compose-more'));
    await fireEvent.press(view.getByTestId('native-mail-save-draft'));
    const uploaded = (mailApi.saveMailDraft as jest.Mock).mock.calls[0][0].files[0];
    expect(uploaded.uri).not.toBe(source.uri);
    expect(await new File(uploaded.uri).text()).toBe('Синтетическое вложение');
    await view.unmount();
  } finally { uuid.mockRestore(); jest.useRealTimers(); }
});

it('does not navigate after leaving during post-send local cleanup', async () => {
  await clearMailComposeDrafts();
  let finishCleanup!: () => void;
  mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.test', subject: 'Синтетическая тема' });
  const view = await render(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Синтетический ответ');
  jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(() => new Promise<void>((resolve) => { finishCleanup = resolve; }));
  await fireEvent.press(view.getByTestId('native-mail-send'));
  await waitFor(() => expect(finishCleanup).toBeDefined());
  expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1);
  await view.unmount();
  await act(async () => { finishCleanup(); });
  expect(router.replace).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
});

it('clears the acknowledged local draft even when the editor unmounts before the ACK', async () => {
  await clearMailComposeDrafts();
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.test', subject: 'Синтетическая тема' });
    let finish!: (value: unknown) => void;
    (mailApi.sendMailMessage as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await act(async () => { jest.advanceTimersByTime(0); });
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Ответ до ухода');
    await act(async () => { jest.advanceTimersByTime(400); });
    const scope = { userId: 1, mailboxId: 'box-1', sourceId: '', mode: 'new' };
    expect((await createMailComposeDraftSession(scope).read())?.body).toBe('Ответ до ухода');
    await fireEvent.press(view.getByTestId('native-mail-send'));
    expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1);
    await view.unmount();
    await act(async () => { finish({ ok: true }); });
    expect(await createMailComposeDraftSession(scope).read()).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('retains original draft HTML through local storage and an offline remount', async () => {
  await clearMailComposeDrafts();
  jest.useFakeTimers();
  try {
    const html = '<table><tr><td><strong>Кириллица</strong></td></tr></table><img src="cid:synthetic-image"><script>forbidden()</script>';
    (mailApi.getMailMessage as jest.Mock).mockResolvedValue({ ...message, id: 'rich-offline', body_html: html, body_text: 'Кириллица', attachments: [] });
    mockedParams.mockReturnValue({ mailboxId: 'box-1', mode: 'draft', draftId: 'rich-offline' });
    const first = await render(<NativeMailComposeScreen />);
    await first.findByTestId('native-mail-rich-editor');
    await act(async () => { jest.advanceTimersByTime(0); });
    await act(async () => { jest.advanceTimersByTime(400); });
    const scope = { userId: 1, mailboxId: 'box-1', sourceId: 'rich-offline', mode: 'draft' };
    expect((await createMailComposeDraftSession(scope).read())?.bodyHtml).toBe(html);
    await first.unmount();
    mockOfflineMode = true;
    (mailApi.getMailMessage as jest.Mock).mockClear().mockRejectedValue(new Error('Synthetic offline'));
    const second = await render(<NativeMailComposeScreen />);
    await second.findByTestId('native-mail-rich-editor');
    const preview = second.getByTestId('native-mail-rich-editor').props.source.html;
    expect(preview).toContain('<strong>Кириллица</strong>');
    expect(preview).not.toContain('forbidden()');
    expect(mailApi.getMailMessage).not.toHaveBeenCalled();
    expect(mailApi.saveMailDraft).not.toHaveBeenCalled();
    expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
    await second.unmount();
  } finally { jest.useRealTimers(); }
});

it.each(['save', 'send'] as const)('uses the confirmed rich HTML snapshot for %s', async (action) => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.test', subject: 'Синтетическая тема' });
  const view = await render(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Предыдущий текст');
  await fireEvent.press(view.getByLabelText('Форматировать текст'));
  const editor = view.getByTestId('native-mail-rich-editor');
  await fireEvent(editor, 'onMessage', { nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
  if (action === 'save') {
    await fireEvent.press(view.getByTestId('native-mail-compose-more'));
    await fireEvent.press(view.getByTestId('native-mail-save-draft'));
  } else await fireEvent.press(view.getByTestId('native-mail-send'));
  expect(mailApi.saveMailDraft).not.toHaveBeenCalled();
  expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
  const code = mockRichInject.mock.calls.map((call) => call[0] as string).find((value) => value.includes("'snapshot'"));
  const id = Number(code?.match(/'snapshot',(\d+)/)?.[1]);
  expect(id).toBeGreaterThan(0);
  await fireEvent(editor, 'onMessage', { nativeEvent: { data: JSON.stringify({ type: 'snapshot', id, html: '<p><strong>Последняя версия</strong></p>', text: 'Последняя версия' }) } });
  const api = action === 'save' ? mailApi.saveMailDraft : mailApi.sendMailMessage;
  await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({ body: '<p><strong>Последняя версия</strong></p>', isHtml: true }), ...(action === 'send' ? [expect.anything()] : [])));
  await view.unmount();
});

it('does not send a stale rich body when WebView fails to confirm its snapshot', async () => {
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.test', subject: 'Тема' });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await act(async () => { jest.advanceTimersByTime(0); });
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Текст до задержки');
    await fireEvent.press(view.getByLabelText('Форматировать текст'));
    await fireEvent(view.getByTestId('native-mail-rich-editor'), 'onMessage', { nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
    await fireEvent.press(view.getByTestId('native-mail-send'));
    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
    expect(view.getByText('Не удалось получить последнюю версию письма. Повторите действие.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    await view.unmount();
  } finally { jest.useRealTimers(); }
});

it.each(['onRenderProcessGone', 'onLoadStart'])('restores the latest received rich text after %s and ignores old events', async (failureEvent) => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.test', subject: 'Тема' });
  const view = await render(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Начальная версия');
  await fireEvent.press(view.getByLabelText('Форматировать текст'));
  expect(view.getByTestId('native-mail-send').props.accessibilityState.disabled).toBe(true);
  const oldEditor = view.getByTestId('native-mail-rich-editor');
  const staleMessage = oldEditor.props.onMessage;
  await fireEvent(oldEditor, 'onMessage', { nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
  await fireEvent(oldEditor, 'onMessage', { nativeEvent: { data: JSON.stringify({ type: 'change', html: '<b>Последняя правка</b>', text: 'Последняя правка' }) } });
  await fireEvent(oldEditor, failureEvent, {});
  expect(view.getByTestId('native-mail-send').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(view.getByLabelText('Восстановить редактор'));
  await act(async () => { staleMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } }); });
  expect(view.getByTestId('native-mail-send').props.accessibilityState.disabled).toBe(true);
  const restored = view.getByTestId('native-mail-rich-editor');
  expect(restored.props.source.html).toContain('<b>Последняя правка</b>');
  expect(restored.props.source.html).not.toContain('Начальная версия');
  await fireEvent(restored, 'onMessage', { nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
  expect(view.getByTestId('native-mail-send').props.accessibilityState.disabled).toBe(false);
  await view.unmount();
});

it('offers rich editor recovery when the initial bridge never becomes ready', async () => {
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1' });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await fireEvent.press(view.getByLabelText('Форматировать текст'));
    expect(view.getByText('Подготавливаем редактор…')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(8000); });
    expect(view.getByLabelText('Восстановить редактор')).toBeTruthy();
    expect(mailApi.saveMailDraft).not.toHaveBeenCalled();
    expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
    await view.unmount();
  } finally { jest.useRealTimers(); }
});

it('restores an uncertain send after reopening and reuses its key only after confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.test', subject: 'Тема' });
    (mailApi.sendMailMessage as jest.Mock).mockRejectedValueOnce(new Error('Synthetic timeout')).mockResolvedValueOnce({ ok: true });
    const first = await render(<NativeMailComposeScreen />);
    await first.findByTestId('native-mail-body');
    await fireEvent.changeText(first.getByTestId('native-mail-body'), 'Повтор после перезапуска');
    await fireEvent.press(first.getByTestId('native-mail-send'));
    await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(first.getByTestId('native-mail-send').props.accessibilityState.disabled).toBe(false));
    const key = (mailApi.sendMailMessage as jest.Mock).mock.calls[0][1].idempotencyKey;
    await fireEvent.press(first.getByLabelText('Проверить отправленные'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(shell)/mail', params: { mailboxId: 'box-1', folder: 'sent' } });
    await first.unmount();
    const second = await render(<NativeMailComposeScreen />);
    await waitFor(() => expect(second.getByTestId('native-mail-body').props.value).toBe('Повтор после перезапуска'));
    await fireEvent.press(second.getByTestId('native-mail-send'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(1);
    await act(async () => { alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Повторить отправку')?.onPress?.(); });
    await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(2));
    expect((mailApi.sendMailMessage as jest.Mock).mock.calls[1][1].idempotencyKey).toBe(key);
    await second.unmount();
  } finally { alert.mockRestore(); }
});

it('does not contact the send endpoint when durable send preparation fails', async () => {
  jest.useFakeTimers();
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1', to: 'synthetic@example.test', subject: 'Тема' });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await act(async () => { jest.advanceTimersByTime(0); });
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Не потерять');
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Synthetic storage failure'));
    await fireEvent.press(view.getByTestId('native-mail-send'));
    expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
    expect(view.getByTestId('native-mail-body').props.value).toBe('Не потерять');
    expect(router.replace).not.toHaveBeenCalled();
    await view.unmount();
  } finally { jest.useRealTimers(); }
});


it.each([false, true])('saves locally before closing offline and keeps input on storage failure: %s', async (failWrite) => {
  jest.useFakeTimers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    mockOfflineMode = true;
    mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1' });
    const view = await render(<NativeMailComposeScreen />);
    await view.findByTestId('native-mail-body');
    await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Офлайн письмо перед закрытием');
    if (failWrite) jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Synthetic storage failure'));
    await fireEvent.press(view.getByLabelText('Назад'));
    const confirm = alert.mock.calls.at(-1)?.[2]?.find((action) => ['Сохранить и закрыть', 'Сохранить на устройстве и закрыть'].includes(action.text || ''))?.onPress;
    expect(confirm).toBeDefined();
    await act(async () => { confirm?.(); });
    expect(mailApi.saveMailDraft).not.toHaveBeenCalled();
    expect(mailApi.sendMailMessage).not.toHaveBeenCalled();
    if (failWrite) {
      expect(router.back).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(view.getByTestId('native-mail-body').props.value).toBe('Офлайн письмо перед закрытием');
      expect(view.getByText('Не удалось сохранить на устройстве. Письмо оставлено в редакторе.')).toBeTruthy();
    } else {
      expect((router.back as jest.Mock).mock.calls.length + (router.replace as jest.Mock).mock.calls.length).toBe(1);
      await view.unmount();
      const restored = await render(<NativeMailComposeScreen />);
      await waitFor(() => expect(restored.getByTestId('native-mail-body').props.value).toBe('Офлайн письмо перед закрытием'));
      await restored.unmount();
    }
  } finally { alert.mockRestore(); jest.useRealTimers(); }
});


it.each(['user', 'source'])('does not apply a late server draft ACK after changing %s', async (change) => {
  let finish!: (value: unknown) => void;
  (mailApi.saveMailDraft as jest.Mock).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-1' });
  const view = await render(<NativeMailComposeScreen />);
  await view.findByTestId('native-mail-body');
  await fireEvent.changeText(view.getByTestId('native-mail-body'), 'Первый редактор');
  await fireEvent.press(view.getByTestId('native-mail-compose-more'));
  await fireEvent.press(view.getByTestId('native-mail-save-draft'));
  expect(mailApi.saveMailDraft).toHaveBeenCalledTimes(1);
  if (change === 'user') mockUserId = 2;
  else mockedParams.mockReturnValue({ mode: 'new', mailboxId: 'box-2' });
  await view.rerender(<NativeMailComposeScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-body').props.value).toBe(''));
  await act(async () => { finish({ draft_id: 'old-draft', attachments: [{ id: 'old-attachment', name: 'Чужое вложение.txt', size: 10 }] }); });
  expect(view.queryByText('Чужое вложение.txt')).toBeNull();
  expect(view.queryByText('Черновик сохранён')).toBeNull();
  expect(view.getByTestId('native-mail-body').props.value).toBe('');
});
