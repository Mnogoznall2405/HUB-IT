import { act, render, waitFor } from '@testing-library/react-native';
import * as chatApi from '../../api/chatApi';
import {
  getChatActiveWorkspace,
  setChatActiveWorkspace,
} from '../../chat/chatActiveWorkspace';
import { NativeChatInboxScreen } from './NativeChatInboxScreen';
import type { ChatWorkspaceKey } from '../../chat/chatAiWorkspace';

const mockWorkspaceTabs = jest.fn();
const mockFolderTabs = jest.fn();
const mockAuth = { user: { id: 1, username: 'mobile-user', role: 'user' }, offlineMode: false };

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
  useAuth: () => mockAuth,
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
    SwipeableConversationRow: React.memo(({ item }: { item: { id: string; title: string } }) => (
      React.createElement(Text, null, item.title)
    )),
  };
});

jest.mock('../../components/chat/ChatGroupEditSheets', () => ({ ChatRenameSheet: () => null }));
jest.mock('../../components/chat/AiConversationActionsSheet', () => ({ AiConversationActionsSheet: () => null }));
jest.mock('../../components/chat/ChatConversationActionsSheet', () => ({ ChatConversationActionsSheet: () => null }));
jest.mock('../../components/chat/ChatFolderAssignSheet', () => ({ ChatFolderAssignSheet: () => null }));
jest.mock('../../components/chat/ChatFolderManagerSheet', () => ({ ChatFolderManagerSheet: () => null }));
jest.mock('../../components/chat/ChatFolderTabs', () => ({
  ChatFolderTabs: (props: unknown) => { mockFolderTabs(props); return null; },
}));
jest.mock('../../components/chat/ChatWorkspaceTabs', () => ({
  ChatWorkspaceTabs: (props: unknown) => { mockWorkspaceTabs(props); return null; },
}));
jest.mock('../../components/chat/NewChatSheet', () => ({ NewChatSheet: () => null }));
jest.mock('../../components/chat/FolderSwipeHost', () => ({
  FolderSwipeHost: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../components/layout/HubConnectionHeader', () => ({ HubConnectionInline: () => null }));
jest.mock('../../navigation/useNativeBottomNavInset', () => ({ useNativeBottomNavInset: () => 0 }));

const page = {
  items: [
    { id: 'c1', kind: 'direct' as const, title: 'Chat one', last_message_seq: 1, unread_count: 2 },
    { id: 'ai1', kind: 'ai' as const, title: 'HUB Ассистент', last_message_seq: 1, unread_count: 5 },
  ],
  has_more: false,
  next_cursor: null,
};
const api = chatApi as jest.Mocked<typeof chatApi>;

const lastWorkspaceProps = () => mockWorkspaceTabs.mock.calls.at(-1)?.[0] as {
  workspace: ChatWorkspaceKey;
  aiUnreadCount: number;
  onChange: (next: ChatWorkspaceKey) => void;
};
const lastFolderProps = () => mockFolderTabs.mock.calls.at(-1)?.[0] as {
  unreadCounts: Record<string, number>;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.offlineMode = false;
  mockAuth.user.id = 1;
  api.getConversationPage.mockResolvedValue(page);
  api.listChatFolders.mockResolvedValue({
    items: [],
    conversation_ids_by_folder: {},
    folder_unread_counts: {},
  });
  api.searchMessagesGlobal.mockResolvedValue([]);
});

it('keeps AI unread on the ИИ tab only and out of chat folder badges', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('chats'));
  expect(lastWorkspaceProps().aiUnreadCount).toBe(5);
  expect(lastFolderProps().unreadCounts.personal).toBe(2);
  expect(lastFolderProps().unreadCounts.unread).toBe(2);
  expect(view.queryByText('HUB Ассистент')).toBeNull();
});

it('defaults to chats when nothing was saved for the user', async () => {
  await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('chats'));
});

it('restores the saved workspace after a reopen', async () => {
  await setChatActiveWorkspace(1, 'ai');
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('ai'));
  await waitFor(() => expect(view.getByText('HUB Ассистент')).toBeTruthy());
  await view.unmount();
  const reopened = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('ai'));
  await waitFor(() => expect(reopened.getByText('HUB Ассистент')).toBeTruthy());
});

it('persists a manual workspace switch and restores it on the next mount', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('chats'));
  await act(async () => lastWorkspaceProps().onChange('ai'));
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('ai'));
  await waitFor(async () => expect(await getChatActiveWorkspace(1)).toBe('ai'));
  await view.unmount();
  await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('ai'));
});

it('prefers requestedWorkspace over the saved one and stores it as the last section', async () => {
  await setChatActiveWorkspace(1, 'ai');
  await render(<NativeChatInboxScreen requestedWorkspace="chats" />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('chats'));
  await waitFor(async () => expect(await getChatActiveWorkspace(1)).toBe('chats'));

  await render(<NativeChatInboxScreen requestedWorkspace="ai" />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('ai'));
  await waitFor(async () => expect(await getChatActiveWorkspace(1)).toBe('ai'));
});

it('resets to the new account saved workspace instead of keeping the previous one', async () => {
  await setChatActiveWorkspace(1, 'ai');
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('ai'));
  await setChatActiveWorkspace(2, 'chats');
  mockAuth.user.id = 2;
  await view.rerender(<NativeChatInboxScreen />);
  await waitFor(() => expect(lastWorkspaceProps().workspace).toBe('chats'));
  expect(await getChatActiveWorkspace(1)).toBe('ai');
});
