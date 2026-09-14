import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as chatApi from '../../api/chatApi';
import { readNativeChatInboxSnapshot, writeNativeChatInboxSnapshot } from '../../chat/nativeChatInboxSnapshot';
import { chatSocket } from '../../chat/chatSocket';
import { subscribeNativeChatConversationRead } from '../../chat/chatActiveConversation';
import { getActiveChatFolderKey } from '../../chat/chatActiveFolder';
import { readNativeSnapshot } from '../../cache/nativeSnapshotCache';
import { NativeChatInboxScreen } from './NativeChatInboxScreen';

const mockConversationRowRender = jest.fn();
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
jest.mock('../../components/chat/ChatFolderTabs', () => ({ ChatFolderTabs: (props: unknown) => { mockFolderTabs(props); return null; } }));
jest.mock('../../components/chat/ChatWorkspaceTabs', () => ({ ChatWorkspaceTabs: () => null }));
jest.mock('../../components/chat/NewChatSheet', () => ({ NewChatSheet: () => null }));
jest.mock('../../components/chat/FolderSwipeHost', () => ({
  FolderSwipeHost: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../components/layout/HubConnectionHeader', () => ({ HubConnectionInline: () => null }));
jest.mock('../../navigation/useNativeBottomNavInset', () => ({ useNativeBottomNavInset: () => 0 }));

const page = {
  items: [
    { id: 'c1', kind: 'direct' as const, title: 'Chat one', last_message_seq: 1, unread_count: 0 },
    { id: 'c2', kind: 'direct' as const, title: 'Chat two', last_message_seq: 1, unread_count: 0 },
  ], has_more: false, next_cursor: null,
};
const api = chatApi as jest.Mocked<typeof chatApi>;
const readSnapshot = jest.mocked(readNativeChatInboxSnapshot);
const writeSnapshot = jest.mocked(writeNativeChatInboxSnapshot);

it('still submits a debounced search when a realtime message updates the inbox', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  api.searchMessagesGlobal.mockResolvedValue([]);
  await fireEvent.changeText(view.getByPlaceholderText('Поиск диалогов и сообщений'), 'needle');
  await act(async () => emit('chat.message.created', { payload: { message: {
    id: 'm-search', conversation_id: 'c1', sender_user_id: 2, body_text: 'Update', conversation_seq: 2,
  } } }));
  await waitFor(() => expect(api.searchMessagesGlobal).toHaveBeenCalledWith('needle', 20));
  expect(api.searchMessagesGlobal).toHaveBeenCalledTimes(1);
});

it('does not show remote search results from the previous account', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  let finish!: (page: any) => void;
  api.getConversationPage.mockImplementation((options) => options?.query
    ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(page));
  api.searchMessagesGlobal.mockResolvedValue([]);
  await fireEvent.changeText(view.getByPlaceholderText('Поиск диалогов и сообщений'), 'needle');
  await waitFor(() => expect(api.searchMessagesGlobal).toHaveBeenCalled());
  mockAuth.user.id = 2;
  await view.rerender(<NativeChatInboxScreen />);
  await act(async () => finish({ ...page, items: [{ id: 'old-search', kind: 'direct', title: 'Old private result' }] }));
  expect(view.queryByText('Old private result')).toBeNull();
});

it('keeps a fresh realtime conversation title over the older remote search hit', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  api.getConversationPage.mockResolvedValue({ ...page, items: [{ ...page.items[0], title: 'needle stale' }] });
  api.searchMessagesGlobal.mockResolvedValue([]);
  await fireEvent.changeText(view.getByPlaceholderText('Поиск диалогов и сообщений'), 'needle');
  await waitFor(() => expect(view.getByText('needle stale')).toBeTruthy());
  await act(async () => emit('chat.conversation.updated', { payload: { conversation: { ...page.items[0], title: 'needle fresh' } } }));
  expect(view.getByText('needle fresh')).toBeTruthy();
  expect(api.searchMessagesGlobal).toHaveBeenCalledTimes(1);
  await act(async () => emit('chat.conversation.removed', { payload: { conversation_id: 'c1' } }));
  expect(view.queryByText('needle fresh')).toBeNull();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.offlineMode = false;
  mockAuth.user.id = 1;
  readSnapshot.mockResolvedValue(null);
  writeSnapshot.mockResolvedValue(true);
  jest.mocked(readNativeSnapshot).mockResolvedValue(null);
  jest.mocked(getActiveChatFolderKey).mockResolvedValue('personal');
  api.getConversationPage.mockResolvedValue(page);
  api.listChatFolders.mockResolvedValue({ items: [], conversation_ids_by_folder: {}, folder_unread_counts: {} });
});

function emit(event: string, payload: unknown) {
  const registration = jest.mocked(chatSocket.on).mock.calls.find(([name]) => name === event);
  if (!registration) throw new Error(`Missing subscription ${event}`);
  registration[1](payload as never);
}

it('persists realtime preview, unread changes and removals for offline reopening', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  await waitFor(() => expect(writeSnapshot).toHaveBeenCalled());
  writeSnapshot.mockClear();
  await act(async () => emit('chat.message.created', { payload: { message: {
    id: 'm2', conversation_id: 'c1', sender_user_id: 2, conversation_seq: 2,
    body_text: 'Fresh message', created_at: '2026-09-14T12:00:00Z',
  } } }));
  await waitFor(() => expect(writeSnapshot).toHaveBeenLastCalledWith(1, expect.objectContaining({
    items: expect.arrayContaining([expect.objectContaining({ id: 'c1', unread_count: 1, last_message_preview: 'Fresh message' })]),
  }), expect.anything()));
  await act(async () => {
    jest.mocked(subscribeNativeChatConversationRead).mock.calls[0][0]('c1');
    emit('chat.conversation.removed', { payload: { conversation_id: 'c2' } });
  });
  await view.unmount();
  const finalPage = writeSnapshot.mock.calls.at(-1)?.[1];
  expect(finalPage?.items).toEqual([expect.objectContaining({ id: 'c1', unread_count: 0, last_message_preview: 'Fresh message' })]);
  mockAuth.offlineMode = true;
  readSnapshot.mockResolvedValue({ savedAt: Date.now(), data: finalPage! });
  const offline = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(offline.getByText('Chat one')).toBeTruthy());
  expect(offline.queryByText('Chat two')).toBeNull();
});

it('does not persist an empty list before asynchronous cache hydration', async () => {
  readSnapshot.mockReturnValue(new Promise(() => undefined));
  await render(<NativeChatInboxScreen />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  expect(writeSnapshot).not.toHaveBeenCalled();
});

it('does not write the previous account list under a new account during hydration', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  await act(async () => emit('chat.conversation.removed', { payload: { conversation_id: 'c2' } }));
  writeSnapshot.mockClear();
  mockAuth.user.id = 2;
  readSnapshot.mockReturnValue(new Promise(() => undefined));
  await view.rerender(<NativeChatInboxScreen />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  await view.unmount();
  expect(writeSnapshot).not.toHaveBeenCalled();
});

it('coalesces a burst of realtime events into one durable update', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  await waitFor(() => expect(writeSnapshot).toHaveBeenCalled());
  writeSnapshot.mockClear();
  await act(async () => {
    for (let index = 0; index < 20; index++) emit('chat.message.created', { payload: { message: {
      id: `m${index + 2}`, conversation_id: 'c1', sender_user_id: 2, conversation_seq: index + 2,
      body_text: `Burst ${index}`, created_at: '2026-09-14T12:00:00Z',
    } } });
  });
  await waitFor(() => expect(writeSnapshot).toHaveBeenCalledTimes(1));
  expect(writeSnapshot.mock.calls[0][1].items[0]).toMatchObject({ unread_count: 20, last_message_preview: 'Burst 19' });
});

it('restores a removed conversation only when an authoritative conversation payload re-adds it', async () => {
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat two')).toBeTruthy());
  await act(async () => emit('chat.conversation.removed', { payload: { conversation_id: 'c2' } }));
  await waitFor(() => expect(writeSnapshot.mock.calls.at(-1)?.[2]?.removedConversationIds).toContain('c2'));
  await act(async () => emit('chat.message.created', { payload: { message: {
    id: 'late', conversation_id: 'c2', sender_user_id: 2, conversation_seq: 2,
  } } }));
  expect(view.queryByText('Chat two')).toBeNull();
  await act(async () => emit('chat.conversation.updated', { payload: { conversation: page.items[1] } }));
  await waitFor(() => expect(view.getByText('Chat two')).toBeTruthy());
  await view.unmount();
  expect(writeSnapshot.mock.calls.at(-1)?.[2]?.removedConversationIds).toEqual([]);
  expect(writeSnapshot.mock.calls.at(-1)?.[1]?.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'c2' })]));
});

it.each(['cache', 'http', 'error'] as const)('ignores late previous-owner folder %s completion', async (stage) => {
  let finish!: (value: any) => void;
  let fail!: (reason: Error) => void;
  const pending = new Promise<any>((resolve, reject) => { finish = resolve; fail = reject; });
  if (stage === 'cache') jest.mocked(readNativeSnapshot).mockReturnValueOnce(pending);
  else api.listChatFolders.mockReturnValueOnce(pending);
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  const currentFolders = { items: [{ id: 'new', name: 'New owner folder' }], conversation_ids_by_folder: {}, folder_unread_counts: {} };
  api.listChatFolders.mockResolvedValue(currentFolders);
  mockAuth.user.id = 2;
  await view.rerender(<NativeChatInboxScreen />);
  await waitFor(() => expect(mockFolderTabs.mock.calls.at(-1)?.[0].customFolders).toEqual(currentFolders.items));
  await act(async () => {
    if (stage === 'error') fail(new Error('old owner request failed'));
    else finish(stage === 'cache' ? { savedAt: 1, data: { ...currentFolders, items: [{ id: 'old', name: 'Old' }] } }
      : { ...currentFolders, items: [{ id: 'old', name: 'Old' }] });
  });
  expect(mockFolderTabs.mock.calls.at(-1)?.[0].customFolders).toEqual(currentFolders.items);
});

it('ignores a late saved active folder from the previous account', async () => {
  let finish!: (value: string) => void;
  jest.mocked(getActiveChatFolderKey).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('Chat one')).toBeTruthy());
  mockAuth.user.id = 2;
  await view.rerender(<NativeChatInboxScreen />);
  await act(async () => finish('old-account-folder'));
  expect(mockFolderTabs.mock.calls.at(-1)?.[0].activeFolderKey).toBe('personal');
});

it('loads the next account while the previous inbox HTTP request is still pending', async () => {
  let finish!: (value: typeof page) => void;
  api.getConversationPage.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeChatInboxScreen />);
  await waitFor(() => expect(api.getConversationPage).toHaveBeenCalledTimes(1));
  api.getConversationPage.mockResolvedValue({ ...page, items: [{ ...page.items[0], id: 'new-chat', title: 'New account chat' }] });
  mockAuth.user.id = 2;
  await view.rerender(<NativeChatInboxScreen />);
  await waitFor(() => expect(view.getByText('New account chat')).toBeTruthy());
  await act(async () => finish(page));
  expect(view.queryByText('Chat one')).toBeNull();
  expect(view.getByText('New account chat')).toBeTruthy();
});

