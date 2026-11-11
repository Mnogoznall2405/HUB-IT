import { act, render, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import * as mailApi from '../../api/mailApi';
import type { MailMessagePreview } from '../../api/mailApi';
import * as mailConfigApi from '../../api/mailConfigApi';
import * as mailboxApi from '../../api/mailMailboxesApi';
import { NativeMailInboxScreen } from './NativeMailInboxScreen';

const mockMailMessageRowRender = jest.fn();

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 0, username: 'mail-performance', role: 'user' },
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../components/mail/NativeMailInboxRow', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    NativeMailInboxMessageRow: React.memo(({ item }: { item: MailMessagePreview }) => {
      mockMailMessageRowRender(item.id);
      return React.createElement(Text, null, item.subject);
    }),
    NativeMailInboxConversationRow: React.memo(() => React.createElement(View)),
    NativeMailInboxDivider: () => React.createElement(View),
  };
});

jest.mock('../../api/mailApi', () => ({
  bulkMailMessageAction: jest.fn(),
  deleteMailMessage: jest.fn(),
  getMailConversations: jest.fn(),
  getMailFolderSummary: jest.fn(),
  getMailFolderTree: jest.fn(),
  getMailMessages: jest.fn(),
  markAllMailMessagesRead: jest.fn(),
  markMailMessageRead: jest.fn(),
  markMailMessageUnread: jest.fn(),
  restoreMailMessage: jest.fn(),
}));

jest.mock('../../api/mailMailboxesApi', () => ({
  listMailboxes: jest.fn(),
}));

jest.mock('../../api/mailConfigApi', () => ({
  DEFAULT_NATIVE_MAIL_PREFERENCES: {
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: false,
    show_preview_snippets: true,
    show_favorites_first: true,
  },
  getNativeMailPreferences: jest.fn(),
}));

jest.mock('../../realtime/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
    on: jest.fn(() => jest.fn()),
    onMailChanged: jest.fn(() => jest.fn()),
  },
}));

const messages = Array.from({ length: 30 }, (_, index): MailMessagePreview => ({
  id: `mail-${index}`,
  mailbox_id: 'box-1',
  folder: 'inbox',
  subject: `Mail ${String(index).padStart(2, '0')}`,
  sender_display: `Sender ${index}`,
  received_at: new Date(2026, 8, 2, 12, 0, index).toISOString(),
  is_read: false,
  body_preview: 'Stable mail preview',
  has_attachments: false,
}));

const mockedParams = useLocalSearchParams as jest.Mock;
const mockedMailApi = mailApi as jest.Mocked<typeof mailApi>;
const mockedConfigApi = mailConfigApi as jest.Mocked<typeof mailConfigApi>;
const mockedMailboxApi = mailboxApi as jest.Mocked<typeof mailboxApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedParams.mockReturnValue({ mailboxId: 'box-1' });
  mockedMailApi.getMailMessages.mockResolvedValue({
    items: messages,
    folder: 'inbox',
    limit: 50,
    offset: 0,
    total: messages.length,
    has_more: false,
  });
  mockedMailApi.getMailConversations.mockResolvedValue({
    items: [],
    folder: 'inbox',
    limit: 50,
    offset: 0,
    total: 0,
    has_more: false,
  });
  mockedMailApi.getMailFolderSummary.mockResolvedValue({ inbox: { total: messages.length, unread: messages.length } });
  mockedMailApi.getMailFolderTree.mockResolvedValue({ items: [{ id: 'inbox', label: 'Входящие', unread: messages.length }] });
  mockedMailboxApi.listMailboxes.mockResolvedValue([
    { id: 'box-1', label: 'Рабочая почта', mailbox_email: 'mail@example.com', is_primary: true, is_active: true },
  ]);
  mockedConfigApi.getNativeMailPreferences.mockResolvedValue({
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: false,
    show_preview_snippets: true,
    show_favorites_first: true,
  });
});

it('does not rerender mounted mail rows for the refresh spinner', async () => {
  const view = await render(<NativeMailInboxScreen />);
  await waitFor(() => expect(view.getByText('Mail 09')).toBeTruthy());
  mockMailMessageRowRender.mockClear();

  mockedMailApi.getMailMessages.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-mail-list').props.onRefresh();
  });

  expect(mockMailMessageRowRender).toHaveBeenCalledTimes(0);
});
