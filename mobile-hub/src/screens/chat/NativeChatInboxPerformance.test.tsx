import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as chatApi from '../../api/chatApi';
import { NativeChatInboxScreen } from './NativeChatInboxScreen';

const mockConversationRowRender = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});

jest.mock('../../api/chatApi', () => ({
  getConversationPage: jest.fn(),
  listChatFolders: jest.fn(),
  searchMessagesGlobal: jest.fn(),
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'mobile-user', role: 'user' },
    offlineMode: false,
  }),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeSnapshot: jest.fn(async () => true),
}));

jest.mock('../../chat/nativeChatInboxSnapshot', () => ({
  readNativeChatInboxSnapshot: jest.fn(async () => null),
  writeNativeChatInboxSnapshot: jest.fn(async () => true),
}));

jest.mock('../../chat/chatActiveConversation', () => ({
  getActiveNativeChatConversationId: jest.fn(() => null),
  subscribeNativeChatConversationRead: jest.fn(() => jest.fn()),
}));

jest.mock('../../chat/chatActiveFolder', () => ({
  getActiveChatFolderKey: jest.fn(async () => 'personal'),
  setActiveChatFolderKey: jest.fn(async () => undefined),
}));

jest.mock('../../chat/chatSocket', () => ({
  shouldUseChatHttpFallback: () => false,
  chatSocket: {
    getStatus: () => 'connected',
    on: jest.fn(() => jest.fn()),
    connect: jest.fn(async () => undefined),
    subscribeInbox: jest.fn(),
  },
}));

jest.mock('../../chat/useAndroidBackHandler', () => ({
  useAndroidBackHandler: jest.fn(),
}));

jest.mock('../../components/chat/SwipeableConversationRow', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    SwipeableConversationRow: React.memo(({ item }: { item: { id: string; title: string } }) => {
      mockConversationRowRender(item.id);
      return React.createElement(Text, null, item.title);
    }),
  };
});

jest.mock('../../components/chat/ChatGroupEditSheets', () => ({ ChatRenameSheet: () => null }));
jest.mock('../../components/chat/AiConversationActionsSheet', () => ({ AiConversationActionsSheet: () => null }));
jest.mock('../../components/chat/ChatConversationActionsSheet', () => ({ ChatConversationActionsSheet: () => null }));
jest.mock('../../components/chat/ChatFolderAssignSheet', () => ({ ChatFolderAssignSheet: () => null }));
jest.mock('../../components/chat/ChatFolderManagerSheet', () => ({ ChatFolderManagerSheet: () => null }));
jest.mock('../../components/chat/ChatFolderTabs', () => ({ ChatFolderTabs: () => null }));
jest.mock('../../components/chat/ChatWorkspaceTabs', () => ({ ChatWorkspaceTabs: () => null }));
jest.mock('../../components/chat/NewChatSheet', () => ({ NewChatSheet: () => null }));
jest.mock('../../components/chat/FolderSwipeHost', () => ({
  FolderSwipeHost: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../components/layout/HubConnectionHeader', () => ({ HubConnectionInline: () => null }));
jest.mock('../../navigation/useNativeBottomNavInset', () => ({ useNativeBottomNavInset: () => 0 }));

const conversations = Array.from({ length: 30 }, (_, index) => ({
  id: `conversation-${index}`,
  kind: 'direct' as const,
  title: `Conversation ${String(index).padStart(2, '0')}`,
  last_message_preview: 'Stable preview',
  last_message_at: `2026-09-02T10:${String(index).padStart(2, '0')}:00+05:00`,
  unread_count: 0,
}));

const mockedChatApi = chatApi as jest.Mocked<typeof chatApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedChatApi.getConversationPage.mockResolvedValue({
    items: conversations,
    has_more: false,
    next_cursor: null,
  });
  mockedChatApi.listChatFolders.mockResolvedValue({
    items: [],
    conversation_ids_by_folder: {},
    folder_unread_counts: {},
  });
  mockedChatApi.searchMessagesGlobal.mockResolvedValue([]);
});

it('does not rerender mounted conversation rows for a search keystroke or refresh spinner', async () => {
  const view = await render(<NativeChatInboxScreen />);

  await waitFor(() => expect(view.getByText('Conversation 29')).toBeTruthy());
  mockConversationRowRender.mockClear();

  await fireEvent.changeText(view.getByLabelText('Поиск чатов'), 'c');
  const draftTypingRenders = mockConversationRowRender.mock.calls.length;
  mockConversationRowRender.mockClear();

  mockedChatApi.getConversationPage.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-chat-inbox-list').props.refreshControl.props.onRefresh();
  });
  const refreshSpinnerRenders = mockConversationRowRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});
