import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import * as mailApi from '../../api/mailApi';
import * as mailConfigApi from '../../api/mailConfigApi';
import * as mailboxApi from '../../api/mailMailboxesApi';
import { NativeMailInboxScreen } from './NativeMailInboxScreen';

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'mail-user', role: 'user', permissions: ['mail.access'] },
    offlineMode: false,
    hasPermission: (permission: string) => permission === 'mail.access',
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));

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
  to: ['me@example.com'],
  to_people: [{ display: 'Я', email: 'me@example.com' }],
  attachments: [],
  can_archive: true,
};

// NOTE: the confirmed empty-trash flow finishes with a detached `void` async that can
// still settle while RNTL unmounts the screen. On React 19 that late update can leave a
// stale act queue that poisons later renders, so this suite keeps the destructive
// scenario last and isolated from the rest of NativeMailScreens.
beforeEach(() => {
  jest.clearAllMocks();
  mockedParams.mockReturnValue({});
  (mailboxApi.listMailboxes as jest.Mock).mockResolvedValue([
    { id: 'box-1', label: 'Рабочая почта', mailbox_email: 'me@example.com', is_primary: true, is_active: true, unread_count: 1 },
  ]);
  (mailApi.getMailMessages as jest.Mock).mockResolvedValue({ items: [message], folder: 'inbox', limit: 50, offset: 0, total: 1, has_more: false });
  (mailApi.getMailConversations as jest.Mock).mockResolvedValue({ items: [], folder: 'inbox', limit: 50, offset: 0, total: 0, has_more: false });
  (mailApi.getMailFolderSummary as jest.Mock).mockResolvedValue({ inbox: { total: 1, unread: 1 }, trash: { total: 1, unread: 0 } });
  (mailApi.getMailFolderTree as jest.Mock).mockResolvedValue({
    items: [
      { id: 'inbox', label: 'Входящие', well_known_key: 'inbox', unread: 1 },
      { id: 'trash', label: 'Удалённые', well_known_key: 'trash', unread: 0 },
    ],
  });
  (mailApi.markAllMailMessagesRead as jest.Mock).mockResolvedValue({ ok: true, changed: 1 });
  (mailApi.deleteMailMessage as jest.Mock).mockResolvedValue({ ok: true });
  (mailApi.bulkMailMessageAction as jest.Mock).mockResolvedValue({ ok: true, failed: 0 });
  (mailConfigApi.getNativeMailPreferences as jest.Mock).mockResolvedValue({
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: true,
    show_preview_snippets: true,
    show_favorites_first: true,
  });
});

it('does not offer empty-trash outside the Trash folder', async () => {
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  const view = await render(<NativeMailInboxScreen />);
  await view.findByTestId('native-mail-message-message-1');
  fireEvent.press(view.getByTestId('native-mail-view-menu'));
  await view.findByTestId('native-mail-view-sheet');
  expect(view.queryByTestId('native-mail-empty-trash')).toBeNull();
});

it('empties the trash through a confirmed bounded permanent bulk delete', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    mockedParams.mockReturnValue({ mailboxId: 'box-1', folder: 'trash' });
    const view = await render(<NativeMailInboxScreen />);
    await view.findByTestId('native-mail-message-message-1');

    fireEvent.press(view.getByTestId('native-mail-view-menu'));
    fireEvent.press(await view.findByTestId('native-mail-empty-trash'));

    expect(alert).toHaveBeenCalledWith('Очистить корзину?', expect.any(String), expect.any(Array));
    const actions = alert.mock.calls.at(-1)?.[2] as Array<{ text?: string; onPress?: () => void }>;
    await act(async () => { actions.find((action) => action.text === 'Удалить всё навсегда')?.onPress?.(); });

    await waitFor(() => expect(mailApi.bulkMailMessageAction).toHaveBeenCalledWith({
      mailboxId: 'box-1',
      action: 'delete',
      messageIds: ['message-1'],
      permanent: true,
    }));
    expect(mailApi.deleteMailMessage).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
  }
});
