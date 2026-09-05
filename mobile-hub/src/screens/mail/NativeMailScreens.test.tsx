import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, StyleSheet } from 'react-native';
import * as mailApi from '../../api/mailApi';
import * as mailConfigApi from '../../api/mailConfigApi';
import * as mailboxApi from '../../api/mailMailboxesApi';
import { writeNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { NativeMailComposeScreen } from './NativeMailComposeScreen';
import { NativeMailConversationScreen } from './NativeMailConversationScreen';
import { NativeMailInboxScreen } from './NativeMailInboxScreen';
import { NativeMailMessageScreen } from './NativeMailMessageScreen';

let mockPermissions = ['mail.access'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'mail-user', role: 'user', permissions: mockPermissions },
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

beforeEach(() => {
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

it('sends an inline formatted quick reply through the existing idempotent reply contract', async () => {
  mockedParams.mockReturnValue({ conversationId: 'thread-1', mailboxId: 'box-1', folder: 'inbox' });
  const view = await render(<NativeMailConversationScreen />);
  const field = await view.findByTestId('native-mail-quick-reply');
  const bar = view.getByTestId('native-mail-quick-reply-bar');
  const scroll = view.getByTestId('native-mail-conversation-scroll');
  expect(field.props.multiline).toBe(false);
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
  expect(field.props.multiline).toBe(false);
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

  await waitFor(() => expect(view.getByTestId('native-mail-to').props.value).toBe('outside@example.net; '));
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

it('does not flatten an HTML draft and opens the exact web editor instead', async () => {
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

  await waitFor(() => expect(view.getByText('Форматированный черновик защищён')).toBeTruthy());
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
  await fireEvent.press(view.getByTestId('native-mail-save-draft'));

  await waitFor(() => expect(mailApi.saveMailDraft).toHaveBeenCalledWith(expect.objectContaining({
    draftId: 'draft-plain',
    retainExistingAttachments: [],
  })));
});

it('reuses the same idempotency key when a timed-out send is retried unchanged', async () => {
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
  await waitFor(() => expect(mailApi.sendMailMessage).toHaveBeenCalledTimes(2));

  const firstKey = (mailApi.sendMailMessage as jest.Mock).mock.calls[0][1].idempotencyKey;
  const retryKey = (mailApi.sendMailMessage as jest.Mock).mock.calls[1][1].idempotencyKey;
  expect(firstKey).toBeTruthy();
  expect(retryKey).toBe(firstKey);
});

it('does not load protected mail data without mail.access', async () => {
  mockPermissions = [];
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(mailApi.getMailMessages).not.toHaveBeenCalled();
});
