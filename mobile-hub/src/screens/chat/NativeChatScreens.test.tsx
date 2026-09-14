import * as motion from '../../accessibility/useReducedMotion';
import { clearNativeChatOutbox, createNativeChatOutbox } from '../../chat/nativeChatOutbox';
jest.mock('../../chat/nativeChatDraftFiles', () => ({
  persistNativeChatDraftFiles: async (_userId: number, files: unknown) => files,
  clearNativeChatDraftFiles: jest.fn(),
  deleteUnreferencedChatFiles: jest.fn(async () => undefined),
  pinNativeChatDraftFiles: () => () => undefined,
}));
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, FlatList, Image, Platform, StyleSheet } from 'react-native';
import * as chatApi from '../../api/chatApi';
import { chatSocket } from '../../chat/chatSocket';
import * as nativeFilePicker from '../../files/nativeFilePicker';
import * as nativeSnapshotCache from '../../cache/nativeSnapshotCache';
import * as nativeChatInboxSnapshot from '../../chat/nativeChatInboxSnapshot';
import { NativeChatInboxScreen } from './NativeChatInboxScreen';
import { NativeChatThreadWithDelivery as NativeChatThreadScreen } from '../../test/NativeChatWithDelivery';

const mockSocketHandlers = new Map<string, Set<(payload: unknown) => void>>();
let mockOfflineMode = false;
let mockChatUserId = 1;
let mockChatWriteAllowed = true;
const mockThreadSnapshots = new Map<string, unknown>();

function emitSocket(event: string, payload: unknown) {
  mockSocketHandlers.get(event)?.forEach((handler) => handler(payload));
}

jest.mock('../../api/chatApi', () => ({
  getConversations: jest.fn(),
  getConversationPage: jest.fn(),
  getConversation: jest.fn(),
  getMessagesPage: jest.fn(),
  getThreadBootstrap: jest.fn(),
  getChatUsers: jest.fn(),
  getAiBots: jest.fn(),
  createDirectConversation: jest.fn(),
  createGroupConversation: jest.fn(),
  openAiBot: jest.fn(),
  createAiConversation: jest.fn(),
  renameAiConversation: jest.fn(),
  deleteAiConversation: jest.fn(),
  resetAiConversationContext: jest.fn(),
  getAiSandboxConversation: jest.fn(),
  getAiConversationAccess: jest.fn(),
  respondAiSandboxPermission: jest.fn(),
  attachAiSandboxArchive: jest.fn(),
  attachAiSandboxFile: jest.fn(),
  markConversationRead: jest.fn(),
  sendTextMessage: jest.fn(),
  editMessage: jest.fn(),
  deleteMessage: jest.fn(),
  toggleReaction: jest.fn(),
  searchMessages: jest.fn(),
  searchMessagesGlobal: jest.fn(),
  setPinnedMessage: jest.fn(),
  forwardMessage: jest.fn(),
  sendFileMessage: jest.fn(),
  listChatFolders: jest.fn(),
  createChatFolder: jest.fn(),
  updateChatFolder: jest.fn(),
  deleteChatFolder: jest.fn(),
  addFolderConversation: jest.fn(),
  removeFolderConversation: jest.fn(),
  getConversationAttachments: jest.fn(),
  updateConversationSettings: jest.fn(),
  getStickerPacks: jest.fn(),
  sendSticker: jest.fn(),
  shareTask: jest.fn(),
  getShareableTasks: jest.fn(),
  importStickerPack: jest.fn(),
  removeStickerPack: jest.fn(),
  getLinkPreview: jest.fn(),
}));

jest.mock('../../chat/chatGiphy', () => ({
  ...jest.requireActual('../../chat/chatGiphy'),
  fetchChatGifs: jest.fn(async () => [{
    id: 'gif-1',
    title: 'кот',
    previewUrl: 'https://media.giphy.com/preview.gif',
    fullUrl: 'https://media.giphy.com/full.gif',
  }]),
  downloadGifToCache: jest.fn(async () => ({
    uri: 'file:///cache/gif_gif-1.gif',
    name: 'gif_gif-1.gif',
    mimeType: 'image/gif',
    size: 32,
    source: 'gif',
  })),
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: mockChatUserId,
      username: 'mobile-user',
      full_name: 'Мобильный пользователь',
      role: 'user',
      permissions: ['chat.read', 'chat.write'],
    },
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => permission === 'chat.write' ? mockChatWriteAllowed : permission === 'chat.read',
  }),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(),
  writeNativeSnapshot: jest.fn(),
  readNativeEntitySnapshot: jest.fn(),
  writeNativeEntitySnapshot: jest.fn(),
}));
jest.mock('../../chat/nativeChatInboxSnapshot', () => ({
  readNativeChatInboxSnapshot: jest.fn(),
  writeNativeChatInboxSnapshot: jest.fn(),
}));

jest.mock('../../chat/chatSocket', () => ({
  shouldUseChatHttpFallback: (status: string) => ['offline', 'error', 'reconnecting'].includes(status),
  chatSocket: {
    getStatus: () => 'connected',
    on: jest.fn((event: string, handler: (payload: unknown) => void) => {
      if (!mockSocketHandlers.has(event)) mockSocketHandlers.set(event, new Set());
      mockSocketHandlers.get(event)!.add(handler);
      return () => mockSocketHandlers.get(event)?.delete(handler);
    }),
    connect: jest.fn(async () => undefined),
    subscribeInbox: jest.fn(),
    subscribeConversation: jest.fn(),
    unsubscribeConversation: jest.fn(),
    sendTyping: jest.fn(),
    watchPresence: jest.fn(),
  },
}));

const mockedChatApi = chatApi as jest.Mocked<typeof chatApi>;

describe('native Chat screens', () => {
  beforeEach(async () => {
    await clearNativeChatOutbox();
    jest.clearAllMocks();
    mockSocketHandlers.clear();
    mockOfflineMode = false;
    mockChatUserId = 1;
    mockChatWriteAllowed = true;
    jest.mocked(nativeSnapshotCache.readNativeSnapshot).mockResolvedValue(null);
    jest.mocked(nativeSnapshotCache.writeNativeSnapshot).mockResolvedValue(true);
    mockThreadSnapshots.clear();
    jest.mocked(nativeSnapshotCache.readNativeEntitySnapshot).mockImplementation(async (scope, userId, id) => {
      const data = mockThreadSnapshots.get(JSON.stringify([scope, userId, id]));
      return (data ? { savedAt: Date.now(), data } : null) as never;
    });
    jest.mocked(nativeSnapshotCache.writeNativeEntitySnapshot).mockImplementation(async (scope, userId, id, data) => {
      mockThreadSnapshots.set(JSON.stringify([scope, userId, id]), JSON.parse(JSON.stringify(data)));
    });
    jest.mocked(nativeChatInboxSnapshot.readNativeChatInboxSnapshot).mockResolvedValue(null);
    jest.mocked(nativeChatInboxSnapshot.writeNativeChatInboxSnapshot).mockResolvedValue(true);
    mockedChatApi.getConversations.mockResolvedValue([{
      id: 'conversation-1',
      kind: 'direct',
      title: 'Мария Иванова',
      last_message_preview: 'Привет',
      unread_count: 2,
    }]);
    mockedChatApi.getConversationPage.mockResolvedValue({
      items: [{
        id: 'conversation-1',
        kind: 'direct',
        title: 'Мария Иванова',
        last_message_preview: 'Привет',
        unread_count: 2,
      }],
      has_more: false,
      next_cursor: null,
    });
    mockedChatApi.listChatFolders.mockResolvedValue({
      items: [{ id: 'work', name: 'Работа', unread_count: 1, conversation_ids: [] }],
      conversation_ids_by_folder: {},
      folder_unread_counts: { personal: 2, groups: 0, tasks: 0, archived: 0 },
    });
    mockedChatApi.getChatUsers.mockResolvedValue([]);
    mockedChatApi.getAiBots.mockResolvedValue([{ id: 'bot-1', name: 'Складской бот' }]);
    mockedChatApi.createDirectConversation.mockResolvedValue({
      id: 'conversation-direct-new',
      kind: 'direct',
      title: 'Иван Петров',
    });
    mockedChatApi.createGroupConversation.mockResolvedValue({
      id: 'conversation-group-new',
      kind: 'group',
      title: 'Проект Альфа',
    });
    mockedChatApi.createAiConversation.mockResolvedValue({
      id: 'ai-general',
      kind: 'ai',
      title: 'Новый чат',
    });
    mockedChatApi.renameAiConversation.mockResolvedValue({
      id: 'ai-today',
      kind: 'ai',
      title: 'Склад',
    });
    mockedChatApi.deleteAiConversation.mockResolvedValue(undefined);
    mockedChatApi.resetAiConversationContext.mockResolvedValue(undefined);
    mockedChatApi.getAiSandboxConversation.mockResolvedValue({ enabled: false });
    mockedChatApi.getAiConversationAccess.mockResolvedValue({ can_use: true });
    mockedChatApi.openAiBot.mockResolvedValue({
      id: 'ai-bot',
      kind: 'ai',
      title: 'Складской бот',
    });
    mockedChatApi.searchMessagesGlobal.mockResolvedValue([]);
    mockedChatApi.setPinnedMessage.mockResolvedValue({
      id: 'conversation-1',
      kind: 'direct',
      title: 'Мария Иванова',
    });
    mockedChatApi.createChatFolder.mockResolvedValue({ id: 'new', name: 'Склад', conversation_ids: [] });
    mockedChatApi.updateChatFolder.mockResolvedValue({ id: 'work', name: 'Работа', conversation_ids: [] });
    mockedChatApi.deleteChatFolder.mockResolvedValue(undefined);
    mockedChatApi.addFolderConversation.mockResolvedValue(undefined);
    mockedChatApi.removeFolderConversation.mockResolvedValue(undefined);
    mockedChatApi.getConversationAttachments.mockResolvedValue({
      items: [],
      has_more: false,
      next_before_attachment_id: null,
    });
    mockedChatApi.getConversation.mockResolvedValue({
      id: 'conversation-1',
      kind: 'direct',
      title: 'Мария Иванова',
    });
    mockedChatApi.getMessagesPage.mockResolvedValue({
      items: [{
        id: 'message-1',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: 'Первое сообщение',
        created_at: '2026-08-23T08:00:00Z',
      }, {
        id: 'message-peer-2',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: 'Второе сообщение',
        created_at: '2026-08-23T07:50:00Z',
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    mockedChatApi.markConversationRead.mockResolvedValue(undefined);
    mockedChatApi.getThreadBootstrap.mockResolvedValue({
      items: [{
        id: 'message-search',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: 'Найденное сообщение',
        created_at: '2026-08-23T07:00:00Z',
      }],
      has_more: false,
      has_older: true,
      has_newer: true,
      cursor_invalid: false,
      older_cursor_message_id: 'message-search',
      newer_cursor_message_id: 'message-search',
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
      initial_anchor_mode: 'message',
      initial_anchor_message_id: 'message-search',
    });
    mockedChatApi.sendTextMessage.mockResolvedValue({
      id: 'message-2',
      conversation_id: 'conversation-1',
      sender_user_id: 1,
      body_text: 'Ответ из APK',
      client_message_id: 'server-client-id',
      created_at: '2026-08-23T08:01:00Z',
      is_own: true,
    });
    mockedChatApi.editMessage.mockResolvedValue({
      id: 'message-own',
      conversation_id: 'conversation-1',
      sender_user_id: 1,
      body_text: 'Исправленный текст',
      edited_at: '2026-08-23T08:02:00Z',
      is_own: true,
    });
    mockedChatApi.deleteMessage.mockResolvedValue({
      id: 'message-own',
      conversation_id: 'conversation-1',
      sender_user_id: 1,
      body_text: 'Сообщение удалено',
      is_deleted: true,
      is_own: true,
    });
    mockedChatApi.toggleReaction.mockResolvedValue([
      { emoji: '👍', count: 1, user_ids: [1], reacted_by_me: true },
    ]);
    mockedChatApi.searchMessages.mockResolvedValue([{
      id: 'message-search',
      conversation_id: 'conversation-1',
      sender_user_id: 2,
      sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
      body_text: 'Найденное сообщение',
    }]);
    mockedChatApi.forwardMessage.mockResolvedValue({
      id: 'message-forwarded',
      conversation_id: 'conversation-1',
      sender_user_id: 1,
      body_text: 'Первое сообщение',
      is_own: true,
      forward_preview: { id: 'message-1', sender_name: 'Мария Иванова', body: 'Первое сообщение' },
    });
    mockedChatApi.sendFileMessage.mockResolvedValue({
      id: 'message-file',
      conversation_id: 'conversation-1',
      sender_user_id: 1,
      body_text: '',
      is_own: true,
      attachments: [{ id: 'attachment-1', file_name: 'report.pdf' }],
    });
    mockedChatApi.updateConversationSettings.mockResolvedValue({
      id: 'conversation-1',
      kind: 'direct',
      title: 'Мария Иванова',
      is_muted: true,
    });
    mockedChatApi.getStickerPacks.mockResolvedValue([{
      id: 'office',
      short_name: 'office',
      title: 'Офис',
      stickers: [{
        id: 'sticker-1',
        emoji: '📎',
        preview_url: '/api/v1/chat/stickers/sticker-1/preview',
      }],
    }]);
    mockedChatApi.sendSticker.mockResolvedValue({
      id: 'message-sticker',
      conversation_id: 'conversation-1',
      sender_user_id: 1,
      is_own: true,
      attachments: [{ id: 'sticker-1', kind: 'sticker', file_name: '📎' }],
    });
    mockedChatApi.importStickerPack.mockResolvedValue([{
      id: 'cats',
      short_name: 'cats',
      title: 'Коты',
      stickers: [{ id: 'sticker-cat', emoji: '🐱' }],
    }]);
    mockedChatApi.removeStickerPack.mockResolvedValue(undefined);
    mockedChatApi.getLinkPreview.mockResolvedValue({ url: 'https://example.com', title: null });
  });

  it('coalesces the mount and focus refresh into one initial inbox request', async () => {
    const view = await render(<NativeChatInboxScreen />);

    await waitFor(() => expect(view.getByText('Мария Иванова')).toBeTruthy());
    expect(mockedChatApi.getConversationPage).toHaveBeenCalledTimes(1);
    expect(mockedChatApi.listChatFolders).toHaveBeenCalledTimes(1);
  });

  it('persists every loaded conversation page for the next offline start', async () => {
    mockedChatApi.getConversationPage
      .mockResolvedValueOnce({
        items: [{ id: 'conversation-1', kind: 'direct', title: 'First' }],
        has_more: true,
        next_cursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'conversation-2', kind: 'direct', title: 'Second' }],
        has_more: false,
        next_cursor: null,
      });
    const view = await render(<NativeChatInboxScreen />);
    await waitFor(() => expect(view.getByText('First')).toBeTruthy());

    await act(async () => {
      fireEvent(view.getByTestId('native-chat-inbox-list'), 'onEndReached');
    });

    await waitFor(() => expect(view.getByText('Second')).toBeTruthy());
    expect(nativeChatInboxSnapshot.writeNativeChatInboxSnapshot).toHaveBeenCalledWith(1, {
      items: [
        expect.objectContaining({ id: 'conversation-1' }),
        expect.objectContaining({ id: 'conversation-2' }),
      ],
      has_more: false,
      next_cursor: null,
    });
  });

  it('finishes the initial state offline when no conversation snapshot exists', async () => {
    mockOfflineMode = true;

    const view = await render(<NativeChatInboxScreen />);

    await waitFor(() => expect(view.getByText('Нет подключения и сохранённых диалогов.')).toBeTruthy());
    expect(mockedChatApi.getConversationPage).not.toHaveBeenCalled();
    expect(mockedChatApi.listChatFolders).not.toHaveBeenCalled();
  });

  it('opens previously loaded chat messages offline without HTTP or socket work', async () => {
    mockOfflineMode = true;
    jest.mocked(nativeSnapshotCache.readNativeEntitySnapshot).mockResolvedValue({
      savedAt: Date.now(),
      data: {
        conversation: { id: 'conversation-1', kind: 'direct', title: 'Мария Иванова' },
        title: 'Мария Иванова',
        messages: [{
          id: 'message-offline',
          conversation_id: 'conversation-1',
          sender_user_id: 2,
          body_text: 'Сохранённое сообщение',
          created_at: '2026-08-30T08:00:00Z',
        }],
        hasOlder: false,
        olderCursor: null,
        hasNewer: false,
        newerCursor: null,
        unreadBoundaryId: null,
        focusAnchorId: null,
        pinnedMessageId: null,
      },
    });

    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Сохранённое сообщение')).toBeTruthy());
    expect(mockedChatApi.getConversation).not.toHaveBeenCalled();
    expect(mockedChatApi.getMessagesPage).not.toHaveBeenCalled();
    expect(chatSocket.subscribeConversation).not.toHaveBeenCalled();
    expect(chatSocket.connect).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('Поиск в диалоге'));
    await fireEvent.changeText(view.getByLabelText('Поиск сообщений в диалоге'), 'сохранённое');
    await fireEvent.press(view.getByLabelText('Найти сообщения'));
    await waitFor(() => expect(view.getByLabelText('Перейти к сообщению: Сохранённое сообщение')).toBeTruthy());
    expect(mockedChatApi.searchMessages).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('Закрыть поиск'));
    await fireEvent.press(view.getByLabelText('Информация о чате Мария Иванова'));
    expect(mockedChatApi.getConversation).not.toHaveBeenCalled();
  });

  async function openMessageActions(
    view: Awaited<ReturnType<typeof render>>,
    text: string,
    actionLabel = 'Ответить',
  ) {
    await fireEvent.press(view.getByText(text));
    await waitFor(() => expect(view.getByLabelText(actionLabel)).toBeTruthy());
  }

  it('loads the native inbox and opens the selected conversation', async () => {
    const view = await render(<NativeChatInboxScreen />);

    await waitFor(() => expect(view.getByText('Мария Иванова')).toBeTruthy());
    await fireEvent.press(view.getByLabelText(/^Мария Иванова/));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'conversation-1' },
    });
  });

  it('creates a direct chat even when the optional AI bot catalog is unavailable', async () => {
    mockedChatApi.getChatUsers.mockResolvedValueOnce([
      { id: 7, username: 'petrov', full_name: 'Иван Петров' },
    ]);
    mockedChatApi.getAiBots.mockRejectedValueOnce(new Error('AI catalog unavailable'));
    const view = await render(<NativeChatInboxScreen />);

    await waitFor(() => expect(view.getByLabelText('Создать диалог')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Создать диалог'));
    await waitFor(() => expect(view.getByLabelText('Открыть диалог с Иван Петров')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть диалог с Иван Петров'));

    await waitFor(() => expect(mockedChatApi.createDirectConversation).toHaveBeenCalledWith(7));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'conversation-direct-new' },
    });
  });

  it('finds a user outside the initial directory page and opens a direct chat', async () => {
    mockedChatApi.getChatUsers
      .mockResolvedValueOnce([
        { id: 7, username: 'petrov', full_name: 'Иван Петров' },
      ])
      .mockResolvedValueOnce([
        { id: 88, username: 'sidorov', full_name: 'Алексей Сидоров' },
      ]);
    const view = await render(<NativeChatInboxScreen />);

    await fireEvent.press(view.getByLabelText('Создать диалог'));
    await waitFor(() => expect(view.getByLabelText('Поиск пользователей')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Поиск пользователей'), 'Сидоров');

    await waitFor(() => {
      expect(mockedChatApi.getChatUsers).toHaveBeenCalledWith({ query: 'Сидоров', limit: 50 });
    });
    await fireEvent.press(view.getByLabelText('Открыть диалог с Алексей Сидоров'));

    await waitFor(() => expect(mockedChatApi.createDirectConversation).toHaveBeenCalledWith(88));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'conversation-direct-new' },
    });
  });

  it('creates a group chat once and opens the new conversation', async () => {
    mockedChatApi.getChatUsers.mockResolvedValueOnce([
      { id: 7, username: 'petrov', full_name: 'Иван Петров' },
    ]);
    const view = await render(<NativeChatInboxScreen />);

    await fireEvent.press(view.getByLabelText('Создать диалог'));
    await waitFor(() => expect(view.getByLabelText('Групповой диалог')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Групповой диалог'));
    await fireEvent.changeText(view.getByLabelText('Название группы'), 'Проект Альфа');
    await fireEvent.press(view.getByLabelText('Добавить Иван Петров'));
    await fireEvent.press(view.getByText('Создать группу (1)'));

    await waitFor(() => expect(mockedChatApi.createGroupConversation).toHaveBeenCalledWith(
      'Проект Альфа',
      [7],
    ));
    expect(mockedChatApi.createGroupConversation).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'conversation-group-new' },
    });
  });

  it('keeps the thread keyboard host enabled and dismisses the keyboard on Android drag', async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await waitFor(() => expect(view.getByLabelText('Текст сообщения')).toBeTruthy());
      expect(view.getByTestId('native-chat-thread-keyboard')).toBeTruthy();
      const messageList = view.getByTestId('native-chat-message-list');
      expect(messageList.props.keyboardDismissMode).toBe('on-drag');
      expect(messageList.props.removeClippedSubviews).toBe(false);
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
    }
  });

  it.each(['Новый текст', ''])('preserves early typing when the saved draft arrives: %s', async (text) => {
    const drafts = require('../../chat/chatDrafts') as typeof import('../../chat/chatDrafts');
    let resolve!: (value: import('../../chat/chatDrafts').NativeChatDraft | null) => void;
    const load = jest.spyOn(drafts, 'getNativeChatDraftState').mockReturnValue(new Promise((done) => { resolve = done; }));
    const save = jest.fn(async (_text: string) => undefined);
    const writer = jest.spyOn(drafts, 'createNativeChatDraftWriter').mockReturnValue(save);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await fireEvent.changeText(await view.findByLabelText('Текст сообщения'), 'Начал набирать');
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), text);
    await act(async () => resolve({ userId: 1, conversationId: 'conversation-1', text: 'Старый сохранённый текст', updatedAt: Date.now() }));
    expect(view.getByLabelText('Текст сообщения').props.value).toBe(text);
    await waitFor(() => expect(save).toHaveBeenCalledWith(text, expect.any(Object)));
    await view.unmount();
    load.mockRestore();
    writer.mockRestore();
  });

  it('persists the latest text on immediate unmount before the debounce fires', async () => {
    const drafts = require('../../chat/chatDrafts') as typeof import('../../chat/chatDrafts');
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Последние символы без ожидания');
    await view.unmount();
    expect(await drafts.getNativeChatDraft(1, 'conversation-1')).toBe('Последние символы без ожидания');
    await drafts.clearNativeChatDraft(1, 'conversation-1');
  });

  it('asks before leaving while the latest draft write is still pending', async () => {
    const drafts = require('../../chat/chatDrafts') as typeof import('../../chat/chatDrafts');
    let finish!: () => void;
    const write = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const factory = jest.spyOn(drafts, 'createNativeChatDraftWriter').mockReturnValue(write);
    const alert = jest.spyOn(Alert, 'alert');
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Ещё не записано');
      await fireEvent.press(view.getByLabelText('Назад к чатам'));
      await waitFor(() => expect(alert).toHaveBeenCalledWith('Выйти без сохранения?', expect.any(String), expect.any(Array), expect.any(Object)));
      expect(router.back).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      const prompt = alert.mock.calls.find(([title]) => title === 'Выйти без сохранения?');
      await act(async () => { prompt?.[2]?.[0].onPress?.(); });
      await waitFor(() => expect(write).toHaveBeenCalledWith('Ещё не записано', expect.any(Object)));
      await act(async () => { finish(); });
      alert.mockClear();
      await fireEvent.press(view.getByLabelText('Назад к чатам'));
      await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
      expect(alert).not.toHaveBeenCalled();
      await view.unmount();
    } finally { factory.mockRestore(); alert.mockRestore(); }
  });

  it('restores a reply draft after remount and sends to the original message', async () => {
    const drafts = require('../../chat/chatDrafts') as typeof import('../../chat/chatDrafts');
    await drafts.setNativeChatDraft(1, 'conversation-1', 'Восстановленный ответ', {
      mode: { type: 'reply', message: { id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 2, body_text: 'Исходное сообщение' } },
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Текст сообщения').props.value).toBe('Восстановленный ответ'));
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledWith('conversation-1', 'Восстановленный ответ', expect.objectContaining({ replyToMessageId: 'message-1' })));
    await view.unmount();
  });

  it('restores a failed outgoing message and retries with its original id', async () => {
    mockedChatApi.sendTextMessage.mockRejectedValueOnce(new Error('Network unavailable'));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Переживает перезапуск');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalled());
    const id = mockedChatApi.sendTextMessage.mock.calls[0][2]?.clientMessageId;
    await view.unmount();
    const restored = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(restored.getAllByText('Переживает перезапуск')).toHaveLength(1));
    await fireEvent.press(restored.getByLabelText('Повторить отправку сообщения'));
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenLastCalledWith('conversation-1', 'Переживает перезапуск', expect.objectContaining({ clientMessageId: id })));
    expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(2);
    await restored.unmount();
  });

  it('removes a failed outgoing message only after confirmation and keeps it removed after remount', async () => {
    mockedChatApi.sendTextMessage.mockRejectedValueOnce(new Error('Network'));
    await expect(createNativeChatOutbox(1, 'conversation-1').send({
      id: 'pending:remove-me', client_message_id: 'remove-me', conversation_id: 'conversation-1',
      sender_user_id: 1, body_text: 'Убрать локальное сообщение',
    }, mockedChatApi.sendTextMessage)).rejects.toThrow();
    const alert = jest.spyOn(Alert, 'alert');
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await fireEvent.press(await view.findByLabelText('Убрать сообщение из очереди'));
      expect(view.getByText('Убрать локальное сообщение')).toBeTruthy();
      const prompt = alert.mock.calls.find(([title]) => title === 'Убрать сообщение из очереди?');
      await act(async () => { prompt?.[2]?.[1].onPress?.(); });
      await waitFor(() => expect(view.queryByText('Убрать локальное сообщение')).toBeNull());
      await view.unmount();
      const restored = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await waitFor(() => expect(restored.getByText('Первое сообщение')).toBeTruthy());
      expect(restored.queryByText('Убрать локальное сообщение')).toBeNull();
      await restored.unmount();
    } finally { alert.mockRestore(); }
  });

  it('keeps typed text and explains the draft quota failure', async () => {
    const drafts = require('../../chat/chatDrafts') as typeof import('../../chat/chatDrafts');
    const save = jest.fn().mockRejectedValue(new drafts.NativeChatDraftLimitError('Черновик не сохранён: достигнут лимит черновиков.'));
    const writer = jest.spyOn(drafts, 'createNativeChatDraftWriter').mockReturnValue(save);
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await fireEvent.changeText(await view.findByLabelText('Текст сообщения'), 'Важный несохранённый текст');
      await waitFor(() => expect(view.getByText('Черновик не сохранён: достигнут лимит черновиков.')).toBeTruthy());
      expect(view.getByLabelText('Текст сообщения').props.value).toBe('Важный несохранённый текст');
      save.mockResolvedValue(undefined);
      await fireEvent.press(view.getByLabelText('Повторить сохранение черновика'));
      await waitFor(() => expect(view.queryByText('Черновик не сохранён: достигнут лимит черновиков.')).toBeNull());
      expect(view.getByLabelText('Текст сообщения').props.value).toBe('Важный несохранённый текст');
      await view.unmount();
    } finally { writer.mockRestore(); }
  });

  it('does not reload messages when reduced motion changes on the open thread', async () => {
    const reduced = jest.spyOn(motion, 'useReducedMotion').mockReturnValue(false);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(mockedChatApi.getMessagesPage).toHaveBeenCalled());
    await act(async () => undefined);
    const requests = mockedChatApi.getMessagesPage.mock.calls.length;
    reduced.mockReturnValue(true);
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await act(async () => undefined);
    expect(mockedChatApi.getMessagesPage).toHaveBeenCalledTimes(requests);
    await view.unmount();
    reduced.mockRestore();
  });

  it('keeps the empty thread message upright inside the inverted list', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });

    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    const emptyState = await waitFor(() => view.getByTestId('native-chat-empty-state'));

    expect(StyleSheet.flatten(emptyState.props.style).transform).toEqual([{ scaleY: -1 }]);
  });

  it('loads a thread and sends text through the normalized Chat API', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Ответ из APK');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));

    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledWith(
      'conversation-1',
      'Ответ из APK',
      expect.objectContaining({ clientMessageId: expect.stringMatching(/^mobile-/) }),
    ));
  });

  it('starts sending even if clearing the saved draft fails', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    const clear = jest.spyOn(require('../../chat/chatDrafts') as typeof import('../../chat/chatDrafts'), 'clearNativeChatDraft').mockRejectedValue(new Error('storage unavailable'));
    try {
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Storage failure send');
      await fireEvent.press(view.getByLabelText('Отправить сообщение'));
      await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledWith('conversation-1', 'Storage failure send', expect.anything()));
      expect(clear).toHaveBeenCalled();
    } finally { clear.mockRestore(); }
  });

  it('keeps both rapid sends visible before either HTTP response arrives', async () => {
    let finish!: (value: import('../../api/types').ChatMessage) => void;
    mockedChatApi.sendTextMessage.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    for (const body of ['Rapid one', 'Rapid two']) {
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), body);
      await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    }
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(1));
    expect(view.getAllByText('Rapid one')).toHaveLength(1);
    expect(view.getAllByText('Rapid two')).toHaveLength(1);
    await act(async () => { finish({ id: 'rapid-first', conversation_id: 'conversation-1', sender_user_id: 1,
      body_text: 'Rapid one', client_message_id: mockedChatApi.sendTextMessage.mock.calls[0][2]?.clientMessageId }); });
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(2));
    const calls = mockedChatApi.sendTextMessage.mock.calls;
    expect(calls[0][2]?.clientMessageId).not.toBe(calls[1][2]?.clientMessageId);
  });

  it('does not jump to a new incoming message while reading history', async () => {
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
      await fireEvent(view.getByTestId('native-chat-message-list'), 'contentSizeChange', 320, 1600);
      await fireEvent.scroll(view.getByTestId('native-chat-message-list'), { nativeEvent: { contentOffset: { y: 600 } } });
      scroll.mockClear();
      await act(async () => {
        emitSocket('chat.message.created', { payload: { message: { id: 'history-live', conversation_id: 'conversation-1', sender_user_id: 2, body_text: 'New while reading', created_at: '2026-09-05T10:00:00Z' } } });
      });
      expect(view.getByTestId('native-chat-message-list').props.maintainVisibleContentPosition).toBeTruthy();
      expect(scroll).not.toHaveBeenCalled();
    } finally { scroll.mockRestore(); }
  });

  it('keeps a newly sent message above the composer by anchoring the inverted list to offset zero', async () => {
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    scrollToOffset.mockClear();
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Сообщение у нижнего края');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    await fireEvent(view.getByTestId('native-chat-message-list'), 'contentSizeChange', 320, 640);

    await waitFor(() => expect(scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({
      offset: 0,
      animated: false,
    })));
    scrollToOffset.mockRestore();
  });

  it('keeps a realtime message that arrives before the initial HTTP page resolves', async () => {
    type MessagePage = Awaited<ReturnType<typeof chatApi.getMessagesPage>>;
    let resolvePage!: (page: MessagePage) => void;
    mockedChatApi.getMessagesPage.mockReturnValueOnce(new Promise<MessagePage>((resolve) => {
      resolvePage = resolve;
    }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(chatSocket.on).toHaveBeenCalledWith(
      'chat.message.created',
      expect.any(Function),
    ));
    await act(async () => {
      emitSocket('chat.message.created', { payload: { message: {
        id: 'message-live',
        conversation_id: 'conversation-1',
        conversation_seq: 2,
        sender_user_id: 2,
        body_text: 'Сообщение из realtime',
        created_at: '2026-08-24T10:01:00Z',
      } } });
      resolvePage({
        items: [{
          id: 'message-http',
          conversation_id: 'conversation-1',
          conversation_seq: 1,
          sender_user_id: 2,
          body_text: 'Сообщение из bootstrap',
          created_at: '2026-08-24T10:00:00Z',
        }],
        has_more: false,
        has_older: false,
        has_newer: false,
        cursor_invalid: false,
        older_cursor_message_id: null,
        newer_cursor_message_id: null,
        viewer_last_read_message_id: null,
        viewer_last_read_at: null,
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(view.getByText('Сообщение из realtime')).toBeTruthy());
    expect(view.getByText('Сообщение из bootstrap')).toBeTruthy();
  });

  it('catches up messages missed while the socket reconnects', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-missed',
        conversation_id: 'conversation-1',
        conversation_seq: 2,
        sender_user_id: 2,
        body_text: 'Пропущенное при reconnect',
        created_at: '2026-08-24T10:02:00Z',
      }],
      has_more: false,
      has_older: true,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: 'message-missed',
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });

    await act(async () => {
      emitSocket('status', 'offline');
      emitSocket('status', 'connected');
      await Promise.resolve();
    });

    await waitFor(() => expect(view.getByText('Пропущенное при reconnect')).toBeTruthy());
    expect(mockedChatApi.getMessagesPage).toHaveBeenCalledTimes(2);
  });

  it('delivers text queued offline automatically when the session returns online', async () => {
    mockedChatApi.sendTextMessage.mockImplementationOnce(async (dialog, body, options) => ({
      id: 'offline-ack', conversation_id: dialog, sender_user_id: 1, body_text: body,
      client_message_id: options?.clientMessageId,
    }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    mockOfflineMode = true;
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Текст из офлайна');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    const queue = require('../../chat/nativeChatOutbox') as typeof import('../../chat/nativeChatOutbox');
    await waitFor(async () => expect(await queue.readNativeChatOutbox(1)).toHaveLength(1));
    expect(mockedChatApi.sendTextMessage).not.toHaveBeenCalled();
    const id = (await queue.readNativeChatOutbox(1))[0].message.client_message_id;
    mockOfflineMode = false;
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledWith(
      'conversation-1', 'Текст из офлайна', expect.objectContaining({ clientMessageId: id }),
    ));
    await waitFor(async () => expect(await queue.readNativeChatOutbox(1)).toHaveLength(0));
    expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('aborts suspended text delivery and resumes the same intent without consuming a retry', async () => {
    mockedChatApi.sendTextMessage.mockImplementationOnce((_dialog, _body, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject({ code: 'ERR_CANCELED' }));
    })).mockImplementationOnce(async (dialog, body, options) => ({
      id: 'resumed-ack', conversation_id: dialog, sender_user_id: 1, body_text: body,
      client_message_id: options?.clientMessageId,
    }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Прерванная отправка');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(1));
    const options = mockedChatApi.sendTextMessage.mock.calls[0][2];
    mockOfflineMode = true;
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    expect(options?.signal?.aborted).toBe(true);
    const queue = require('../../chat/nativeChatOutbox') as typeof import('../../chat/nativeChatOutbox');
    await waitFor(async () => expect((await queue.readNativeChatOutbox(1))[0].delivery).toEqual(
      expect.objectContaining({ state: 'retry', attempts: 0 }),
    ));
    mockOfflineMode = false;
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(2));
    expect(mockedChatApi.sendTextMessage.mock.calls[1][2]?.clientMessageId).toBe(options?.clientMessageId);
    await waitFor(async () => expect(await queue.readNativeChatOutbox(1)).toHaveLength(0));
  });

  it.each([[true, false], [false, false], [true, true], [false, true]])('keeps a reachable history cursor after a reconnect gap (near bottom: %s, fresh WS: %s)', async (nearBottom, freshSocket) => {
    const base = await mockedChatApi.getMessagesPage('conversation-1');
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    if (!nearBottom) await fireEvent.scroll(view.getByTestId('native-chat-message-list'), {
      nativeEvent: { contentOffset: { y: 600 } },
    });
    const latestItems = Array.from({ length: 80 }, (_, index) => ({
      id: `reconnect-${index}`, conversation_id: 'conversation-1', sender_user_id: 2,
      body_text: `Reconnect ${index}`, created_at: new Date(Date.UTC(2026, 8, 14, 10, 0, 80 - index)).toISOString(),
    }));
    if (freshSocket) await act(async () => { emitSocket('chat.message.created', { payload: { message: latestItems[0] } }); });
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({ ...base, items: latestItems,
      has_older: true, older_cursor_message_id: 'reconnect-79',
    });
    await act(async () => { emitSocket('status', 'reconnecting'); emitSocket('status', 'connected'); });
    if (nearBottom) await fireEvent(view.getByTestId('native-chat-message-list'), 'onEndReached');
    else await fireEvent.scroll(view.getByTestId('native-chat-message-list'),
      { nativeEvent: { contentOffset: { y: 0 } } });
    await waitFor(() => expect(mockedChatApi.getMessagesPage).toHaveBeenLastCalledWith(
      'conversation-1', expect.objectContaining(nearBottom
        ? { beforeMessageId: 'reconnect-79' }
        : { afterMessageId: 'message-1' }),
    ));
  });

  it('renders one pending bubble before HTTP ACK and replaces its spinner without duplicating text', async () => {
    let finish!: (message: import('../../api/types').ChatMessage) => void;
    mockedChatApi.sendTextMessage.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await view.findByText('Первое сообщение');
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'UI pending to confirmed');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    expect(view.getAllByText('UI pending to confirmed')).toHaveLength(1);
    expect(view.getByTestId('chat-message-sending-spinner')).toBeTruthy();
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(1));
    await act(async () => { finish({ id: 'ui-ack', conversation_id: 'conversation-1', sender_user_id: 1,
      body_text: 'UI pending to confirmed', client_message_id: mockedChatApi.sendTextMessage.mock.calls[0][2]?.clientMessageId }); });
    await waitFor(() => expect(view.queryByTestId('chat-message-sending-spinner')).toBeNull());
    expect(view.getAllByText('UI pending to confirmed')).toHaveLength(1);
    expect(view.queryByText('Не отправлено · повторить')).toBeNull();
    await view.unmount();
  });

  it('restores one offline bubble across remount and confirms it once after reconnect', async () => {
    const queue = createNativeChatOutbox(1, 'conversation-1');
    mockedChatApi.sendTextMessage.mockImplementationOnce(async (dialog, body, options) => ({
      id: 'ui-offline-ack', conversation_id: dialog, sender_user_id: 1, body_text: body,
      client_message_id: options?.clientMessageId,
    }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await view.findByText('Первое сообщение');
    mockOfflineMode = true;
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'UI offline remount');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    await waitFor(() => expect(view.getByText('Ожидает подключения')).toBeTruthy());
    expect(view.getAllByText('UI offline remount')).toHaveLength(1);
    const clientId = (await queue.read())[0].client_message_id;
    await view.unmount();
    const restored = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(restored.getByText('Ожидает подключения')).toBeTruthy());
    expect(restored.getAllByText('UI offline remount')).toHaveLength(1);
    expect(mockedChatApi.sendTextMessage).not.toHaveBeenCalled();
    mockOfflineMode = false;
    await restored.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(async () => expect(await queue.read()).toHaveLength(0));
    expect(restored.getAllByText('UI offline remount')).toHaveLength(1);
    expect(restored.queryByText('Ожидает подключения')).toBeNull();
    expect(restored.queryByTestId('chat-message-sending-spinner')).toBeNull();
    expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockedChatApi.sendTextMessage.mock.calls[0][2]?.clientMessageId).toBe(clientId);
    await restored.unmount();
  });

  it('renders cancellation before the native transport finishes aborting', async () => {
    let rejectTransport!: (cause: unknown) => void;
    mockedChatApi.sendTextMessage.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectTransport = reject; }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await view.findByText('Первое сообщение');
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'UI cancelled while aborting');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(1));
    const options = mockedChatApi.sendTextMessage.mock.calls[0][2];
    await act(async () => { await createNativeChatOutbox(1, 'conversation-1').cancelDelivery(options!.clientMessageId!); });
    await waitFor(() => expect(view.getByText('Отправка отменена · повторить')).toBeTruthy());
    expect(view.queryByTestId('chat-message-sending-spinner')).toBeNull();
    expect(view.getAllByText('UI cancelled while aborting')).toHaveLength(1);
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => { rejectTransport({ code: 'ERR_CANCELED' }); });
    await view.unmount();
  });

  it('preserves a websocket message received while a disconnected latest page is loading', async () => {
    const base = await mockedChatApi.getMessagesPage('conversation-1');
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    let finish!: (page: typeof base) => void;
    mockedChatApi.getMessagesPage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { emitSocket('status', 'reconnecting'); emitSocket('status', 'connected'); });
    await act(async () => { emitSocket('chat.message.created', { payload: { message: {
      id: 'newer-than-rest', conversation_id: 'conversation-1', sender_user_id: 2,
      body_text: 'Newer than REST', created_at: '2026-09-14T10:02:00Z',
    } } }); });
    expect(view.getByText('Newer than REST')).toBeTruthy();
    await act(async () => { finish({ ...base, items: [{
      id: 'latest-rest', conversation_id: 'conversation-1', sender_user_id: 2,
      body_text: 'Latest REST', created_at: '2026-09-14T10:01:00Z',
    }], has_older: true, older_cursor_message_id: 'latest-rest' }); });
    expect(view.getByText('Newer than REST')).toBeTruthy();
  });

  it('ignores a late reconnect page after switching to offline mode', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    let finish!: (value: any) => void;
    mockedChatApi.getMessagesPage.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await act(async () => {
      emitSocket('status', 'offline');
      emitSocket('status', 'connected');
    });
    await waitFor(() => expect(finish).toBeDefined());
    mockOfflineMode = true;
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await act(async () => {
      finish({ items: [{ id: 'late-page', conversation_id: 'conversation-1', sender_user_id: 2,
        body_text: 'Поздний ответ старой загрузки' }], has_newer: false });
    });
    expect(view.queryByText('Поздний ответ старой загрузки')).toBeNull();
  });

  it('marks the latest message read after loading the final newer page', async () => {
    mockedChatApi.getMessagesPage
      .mockResolvedValueOnce({
        items: [{
          id: 'message-old',
          conversation_id: 'conversation-1',
          sender_user_id: 2,
          body_text: 'Старое сообщение',
          created_at: '2026-08-23T07:00:00Z',
        }],
        has_more: true,
        has_older: true,
        has_newer: true,
        cursor_invalid: false,
        older_cursor_message_id: 'message-old',
        newer_cursor_message_id: 'message-old',
        viewer_last_read_message_id: null,
        viewer_last_read_at: null,
      })
      .mockResolvedValueOnce({
        items: [{
          id: 'message-new',
          conversation_id: 'conversation-1',
          sender_user_id: 2,
          body_text: 'Последнее сообщение',
          created_at: '2026-08-23T08:00:00Z',
        }],
        has_more: false,
        has_older: true,
        has_newer: false,
        cursor_invalid: false,
        older_cursor_message_id: 'message-old',
        newer_cursor_message_id: null,
        viewer_last_read_message_id: null,
        viewer_last_read_at: null,
      });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Старое сообщение')).toBeTruthy());
    await fireEvent.scroll(view.getByTestId('native-chat-message-list'), {
      nativeEvent: { contentOffset: { y: 0 } },
    });

    await waitFor(() => expect(mockedChatApi.getMessagesPage).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.objectContaining({ afterMessageId: 'message-old' }),
    ));
    await waitFor(() => expect(mockedChatApi.markConversationRead).toHaveBeenCalledWith(
      'conversation-1',
      'message-new',
    ));
  });

  it('replies to a message through the visible actions menu', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение');
    await fireEvent.press(view.getByLabelText('Ответить'));
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Ответ с цитатой');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));

    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledWith(
      'conversation-1',
      'Ответ с цитатой',
      expect.objectContaining({ replyToMessageId: 'message-1' }),
    ));
  });

  it.each(['Quoted message not found', 'Conversation not found'])('handles reply rejection precisely: %s', async (detail) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockedChatApi.sendTextMessage.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: { detail } } });
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
      await openMessageActions(view, 'Первое сообщение', 'Ответить');
      await fireEvent.press(view.getByLabelText('Ответить'));
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Ответ на отсутствующее сообщение');
      await fireEvent.press(view.getByLabelText('Отправить сообщение'));
      await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(1));
      const queue = require('../../chat/nativeChatOutbox') as typeof import('../../chat/nativeChatOutbox');
      await waitFor(async () => expect(await queue.createNativeChatOutbox(1, 'conversation-1').read()).toHaveLength(1));
      if (detail !== 'Quoted message not found') {
        expect(alert).not.toHaveBeenCalledWith('Исходное сообщение недоступно', expect.anything(), expect.anything());
        return;
      }
      await waitFor(() => expect(alert).toHaveBeenCalledWith('Исходное сообщение недоступно', expect.any(String), expect.any(Array)));
      expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(1);
      const previousId = mockedChatApi.sendTextMessage.mock.calls[0][2]?.clientMessageId;
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Новый независимый черновик');
      const action = alert.mock.calls.find(([title]) => title === 'Исходное сообщение недоступно')?.[2]?.find((button) => button.text === 'Отправить без цитаты');
      await act(async () => { action?.onPress?.(); });
      await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledTimes(2));
      expect(mockedChatApi.sendTextMessage.mock.calls[1]).toEqual(['conversation-1', 'Ответ на отсутствующее сообщение', expect.objectContaining({ replyToMessageId: undefined })]);
      expect(mockedChatApi.sendTextMessage.mock.calls[1][2]?.clientMessageId).not.toBe(previousId);
      expect(view.getByLabelText('Текст сообщения').props.value).toBe('Новый независимый черновик');
    } finally { alert.mockRestore(); }
  });

  it.each(['offline', 'permission', 'user', 'conversation'].flatMap((change) => [
    [change, false] as const, [change, true] as const,
  ]))('ignores an old unquote confirmation after %s changes (upload=%s)', async (change, upload) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const transport = upload ? mockedChatApi.sendFileMessage : mockedChatApi.sendTextMessage;
    transport.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: { detail: 'Quoted message not found' } } });
    if (upload) {
      jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue([{
        uri: 'file:///cache/report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 256, source: 'document',
      }]);
      jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    }
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
      await openMessageActions(view, 'Первое сообщение', 'Ответить');
      await fireEvent.press(view.getByLabelText('Ответить'));
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Ответ старого экрана');
      if (upload) {
        await fireEvent.press(view.getByLabelText('Добавить вложение'));
        await fireEvent.press(view.getByLabelText('Файл'));
      } else await fireEvent.press(view.getByLabelText('Отправить сообщение'));
      await waitFor(() => expect(alert).toHaveBeenCalledWith('Исходное сообщение недоступно', expect.any(String), expect.any(Array)));
      const action = alert.mock.calls.find(([title]) => title === 'Исходное сообщение недоступно')?.[2]?.find((button) => button.text === 'Отправить без цитаты');
      const queue = require('../../chat/nativeChatOutbox') as typeof import('../../chat/nativeChatOutbox');
      const before = await queue.createNativeChatOutbox(1, 'conversation-1').read();
      if (change === 'offline') mockOfflineMode = true;
      if (change === 'permission') mockChatWriteAllowed = false;
      if (change === 'user') mockChatUserId = 2;
      await view.rerender(<NativeChatThreadScreen conversationId={change === 'conversation' ? 'conversation-2' : 'conversation-1'} />);
      mockOfflineMode = false;
      mockChatWriteAllowed = true;
      mockChatUserId = 1;
      await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
      await act(async () => { action?.onPress?.(); });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(await queue.createNativeChatOutbox(1, 'conversation-1').read()).toEqual(before);
    } finally { alert.mockRestore(); }
  });

  it('edits an own text message in the composer', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-own',
        conversation_id: 'conversation-1',
        sender_user_id: 1,
        body_text: 'Исходный текст',
        created_at: '2026-08-23T08:00:00Z',
        is_own: true,
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Исходный текст')).toBeTruthy());
    await openMessageActions(view, 'Исходный текст', 'Редактировать');
    await fireEvent.press(view.getByLabelText('Редактировать'));
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Исправленный текст');
    await fireEvent.press(view.getByLabelText('Сохранить изменения'));

    await waitFor(() => expect(mockedChatApi.editMessage).toHaveBeenCalledWith(
      'conversation-1',
      'message-own',
      'Исправленный текст',
    ));
  });

  it('preserves the original draft when changing edit targets and then switching to reply', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: ['Первый исходник', 'Второй исходник'].map((body_text, index) => ({
        id: `edit-${index}`, conversation_id: 'conversation-1', sender_user_id: 1,
        body_text, created_at: '2026-08-23T08:00:00Z', is_own: true,
      })),
      has_more: false, has_older: false, has_newer: false, cursor_invalid: false,
      older_cursor_message_id: null, newer_cursor_message_id: null,
      viewer_last_read_message_id: null, viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первый исходник')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Мой незавершённый черновик');
    await openMessageActions(view, 'Первый исходник', 'Редактировать');
    await fireEvent.press(view.getByLabelText('Редактировать'));
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Незавершённая правка');
    await openMessageActions(view, 'Второй исходник', 'Редактировать');
    await fireEvent.press(view.getByLabelText('Редактировать'));
    await fireEvent.press(view.getByLabelText('Отменить редактирование'));
    expect(view.getByLabelText('Текст сообщения').props.value).toBe('Мой незавершённый черновик');
    // A repeated tap inside the quick-reaction interval intentionally means a reaction.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    await openMessageActions(view, 'Первый исходник', 'Редактировать');
    await fireEvent.press(view.getByLabelText('Редактировать'));
    await openMessageActions(view, 'Второй исходник', 'Ответить');
    await fireEvent.press(view.getByLabelText('Ответить'));
    expect(view.getByLabelText('Текст сообщения').props.value).toBe('Мой незавершённый черновик');
    expect(view.getByLabelText('Отменить ответ')).toBeTruthy();
  });

  it('updates a deleted reply source without losing the typed response', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение');
    await fireEvent.press(view.getByLabelText('Ответить'));
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Мой ответ');
    await act(async () => { emitSocket('chat.message.deleted', { payload: { message: {
      id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 2, is_deleted: true, body_text: '',
    } } }); });
    await waitFor(() => expect(view.queryByText('Первое сообщение')).toBeNull());
    expect(view.getByLabelText('Текст сообщения').props.value).toBe('Мой ответ');
    await fireEvent.press(view.getByLabelText('Отправить сообщение'));
    await waitFor(() => expect(mockedChatApi.sendTextMessage).toHaveBeenCalledWith('conversation-1', 'Мой ответ', expect.objectContaining({ replyToMessageId: 'message-1' })));
  });

  it('ignores update/delete events for messages outside the loaded window', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());

    await act(async () => { emitSocket('chat.message.updated', { payload: { message: {
      id: 'far-away-message', conversation_id: 'conversation-1', sender_user_id: 2,
      body_text: 'Отредактировано вне окна', created_at: '2026-01-01T00:00:00Z',
    } } }); });
    await act(async () => { emitSocket('chat.message.deleted', { payload: { message: {
      id: 'deleted-away', conversation_id: 'conversation-1', sender_user_id: 2, is_deleted: true,
    } } }); });

    // Events for messages the user never loaded must not appear in the list.
    expect(view.queryByText('Отредактировано вне окна')).toBeNull();

    // While a known message is patched in place.
    await act(async () => { emitSocket('chat.message.deleted', { payload: { message: {
      id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 2, is_deleted: true, body_text: '',
    } } }); });
    await waitFor(() => expect(view.queryByText('Первое сообщение')).toBeNull());
  });

  it('ignores an already captured cancel callback while an edit is saving', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{ id: 'edit-owned', conversation_id: 'conversation-1', sender_user_id: 1,
        body_text: 'Сообщение для сохранения', created_at: '2026-08-23T08:00:00Z', is_own: true }],
      has_more: false, has_older: false, has_newer: false, cursor_invalid: false,
      older_cursor_message_id: null, newer_cursor_message_id: null,
      viewer_last_read_message_id: null, viewer_last_read_at: null,
    });
    let reject!: (error: Error) => void;
    mockedChatApi.editMessage.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const composer = require('../../components/chat/ChatComposer') as typeof import('../../components/chat/ChatComposer');
    const originalComposer = composer.ChatComposer;
    let staleCancel: (() => void) | undefined;
    const renderComposer = jest.spyOn(composer, 'ChatComposer').mockImplementation((props) => {
      if (props.mode === 'edit' && !props.busy) staleCancel = props.onCancelMode;
      return originalComposer(props);
    });
    try {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Сообщение для сохранения')).toBeTruthy());
    await openMessageActions(view, 'Сообщение для сохранения', 'Редактировать');
    await fireEvent.press(view.getByLabelText('Редактировать'));
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Правка до ответа сервера');
    expect(staleCancel).toBeDefined();
    await fireEvent.press(view.getByLabelText('Сохранить изменения'));
    await waitFor(() => expect(mockedChatApi.editMessage).toHaveBeenCalled());
    await act(async () => { staleCancel?.(); });
    expect(view.getByLabelText('Текст сообщения').props.value).toBe('Правка до ответа сервера');
    expect(view.getByLabelText('Отменить редактирование')).toBeTruthy();
    await act(async () => { reject(new Error('synthetic offline')); });
    await fireEvent.press(view.getByLabelText('Отменить редактирование'));
    expect(view.queryByLabelText('Сохранить изменения')).toBeNull();
    } finally { renderComposer.mockRestore(); }
  });

  it('keeps an edit and the original draft when its source is deleted before saving', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{ id: 'edit-owned', conversation_id: 'conversation-1', sender_user_id: 1, body_text: 'Исходник правки', is_own: true }],
      has_more: false, has_older: false, has_newer: false, cursor_invalid: false,
      older_cursor_message_id: null, newer_cursor_message_id: null, viewer_last_read_message_id: null, viewer_last_read_at: null,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await view.findByText('Исходник правки');
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Обычный черновик');
      await openMessageActions(view, 'Исходник правки', 'Редактировать');
      await fireEvent.press(view.getByLabelText('Редактировать'));
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Моя правка');
      await act(async () => { emitSocket('chat.message.deleted', { payload: { message: {
        id: 'edit-owned', conversation_id: 'conversation-1', sender_user_id: 1, is_deleted: true, body_text: '',
      } } }); });
      await fireEvent.press(view.getByLabelText('Сохранить изменения'));
      expect(mockedChatApi.editMessage).not.toHaveBeenCalled();
      expect(alert).toHaveBeenCalledWith('Сообщение удалено', expect.stringContaining('Текст правки остался'));
      expect(view.getByLabelText('Текст сообщения').props.value).toBe('Моя правка');
      await fireEvent.press(view.getByLabelText('Отменить редактирование'));
      expect(view.getByLabelText('Текст сообщения').props.value).toBe('Обычный черновик');
    } finally { alert.mockRestore(); }
  });

  it('optimistically toggles a reaction from the actions menu', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение', 'Добавить реакцию 👍');
    await fireEvent.press(view.getByLabelText('Добавить реакцию 👍'));

    await waitFor(() => expect(mockedChatApi.toggleReaction).toHaveBeenCalledWith(
      'conversation-1',
      'message-1',
      '👍',
    ));
    expect(view.getByText('👍 1')).toBeTruthy();
  });

  it('confirms deletion before calling the API', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-own',
        conversation_id: 'conversation-1',
        sender_user_id: 1,
        body_text: 'Удаляемый текст',
        created_at: '2026-08-23T08:00:00Z',
        is_own: true,
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Удаляемый текст')).toBeTruthy());
    await openMessageActions(view, 'Удаляемый текст', 'Удалить');
    await fireEvent.press(view.getByLabelText('Удалить'));

    const destructive = alert.mock.calls[0]?.[2]?.find((button) => button.style === 'destructive');
    await act(async () => destructive?.onPress?.());
    await waitFor(() => expect(mockedChatApi.deleteMessage).toHaveBeenCalledWith(
      'conversation-1',
      'message-own',
    ));
  });

  it.each(['edit', 'delete'])('ignores a late %s result after changing conversation', async (action) => {
    const base = await mockedChatApi.getMessagesPage('conversation-1');
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({ ...base, items: [{
      id: 'own-late-action', conversation_id: 'conversation-1', sender_user_id: 1,
      body_text: 'Own action source', is_own: true,
    }] });
    let finish!: (message: Awaited<ReturnType<typeof chatApi.editMessage>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof chatApi.editMessage>>>((resolve) => { finish = resolve; });
    if (action === 'edit') mockedChatApi.editMessage.mockReturnValueOnce(pending);
    else mockedChatApi.deleteMessage.mockReturnValueOnce(pending);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Own action source')).toBeTruthy());
    await openMessageActions(view, 'Own action source', action === 'edit' ? 'Редактировать' : 'Удалить');
    await fireEvent.press(view.getByLabelText(action === 'edit' ? 'Редактировать' : 'Удалить'));
    if (action === 'edit') {
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Changed source');
      await fireEvent.press(view.getByLabelText('Сохранить изменения'));
    } else {
      await act(async () => { alert.mock.calls.at(-1)?.[2]?.find((button) => button.style === 'destructive')?.onPress?.(); });
    }
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
    await act(async () => { finish({ id: 'stale-action-result', conversation_id: 'conversation-1',
      sender_user_id: 1, body_text: 'Stale action result' }); });
    expect(view.queryByText('Stale action result')).toBeNull();
  });

  it('ignores a late forward picker after changing conversation', async () => {
    let finish!: (items: Awaited<ReturnType<typeof chatApi.getConversations>>) => void;
    mockedChatApi.getConversations.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение', 'Переслать');
    await fireEvent.press(view.getByLabelText('Переслать'));
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
    await act(async () => { finish([{ id: 'target', kind: 'direct', title: 'Old forward target' }]); });
    expect(view.queryByLabelText('Переслать в Old forward target')).toBeNull();
  });

  it('does not surface a previous conversation reaction failure', async () => {
    let reject!: (error: Error) => void;
    mockedChatApi.toggleReaction.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение', 'Добавить реакцию 👍');
    await fireEvent.press(view.getByLabelText('Добавить реакцию 👍'));
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
    alert.mockClear();
    await act(async () => { reject(new Error('Old request failed')); });
    expect(alert).not.toHaveBeenCalled();
  });

  it('stops an obsolete forward batch after its current acknowledgement', async () => {
    let finish!: (message: Awaited<ReturnType<typeof chatApi.forwardMessage>>) => void;
    mockedChatApi.forwardMessage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение', 'Выбрать');
    await fireEvent.press(view.getByLabelText('Выбрать'));
    await fireEvent.press(view.getByText('Второе сообщение'));
    await fireEvent.press(view.getByLabelText('Переслать'));
    await fireEvent.press(await view.findByLabelText('Переслать в Мария Иванова'));
    await waitFor(() => expect(mockedChatApi.forwardMessage).toHaveBeenCalledTimes(1));
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
    await act(async () => { finish({ id: 'old-forward-ack', conversation_id: 'conversation-1',
      sender_user_id: 1, body_text: 'Old forward ACK' }); });
    expect(mockedChatApi.forwardMessage).toHaveBeenCalledTimes(1);
    expect(view.queryByText('Old forward ACK')).toBeNull();
  });

  it('ignores previous conversation details returned after opening another chat', async () => {
    const base = await mockedChatApi.getConversation('conversation-1');
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    let finish!: (conversation: typeof base) => void;
    mockedChatApi.getConversation.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await fireEvent.press(view.getByLabelText(/^Информация о чате/));
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
    await act(async () => { finish({ ...base, title: 'Old conversation details' }); });
    expect(view.queryAllByText('Old conversation details')).toHaveLength(0);
    expect(view.queryByLabelText('Информация о чате Old conversation details')).toBeNull();
  });

  it('closes completed search results when changing conversation', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Поиск в диалоге'));
    await fireEvent.changeText(view.getByLabelText('Поиск сообщений в диалоге'), 'найденное');
    await fireEvent.press(view.getByLabelText('Найти сообщения'));
    expect(await view.findByLabelText('Перейти к сообщению: Найденное сообщение')).toBeTruthy();
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
    expect(view.queryByLabelText('Перейти к сообщению: Найденное сообщение')).toBeNull();
  });

  it('searches inside the current conversation and opens a focused bootstrap', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Поиск в диалоге'));
    await fireEvent.changeText(view.getByLabelText('Поиск сообщений в диалоге'), 'найденное');
    await fireEvent.press(view.getByLabelText('Найти сообщения'));
    await waitFor(() => expect(view.getByText('Найденное сообщение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Перейти к сообщению: Найденное сообщение'));

    await waitFor(() => expect(mockedChatApi.getThreadBootstrap).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ focusMessageId: 'message-search' }),
    ));
    await waitFor(() => expect(view.getByLabelText(/Результат поиска.*Найденное сообщение/)).toBeTruthy());
  });

  it.each(['conversation', 'offline'])('ignores a late focused history page after changing %s', async (change) => {
    let finish!: (page: Awaited<ReturnType<typeof chatApi.getThreadBootstrap>>) => void;
    const focusedPage = await mockedChatApi.getThreadBootstrap('conversation-1');
    mockedChatApi.getThreadBootstrap.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Поиск в диалоге'));
    await fireEvent.changeText(view.getByLabelText('Поиск сообщений в диалоге'), 'найденное');
    await fireEvent.press(view.getByLabelText('Найти сообщения'));
    await fireEvent.press(await view.findByLabelText('Перейти к сообщению: Найденное сообщение'));
    expect(finish).toBeDefined();
    if (change === 'offline') mockOfflineMode = true;
    await view.rerender(<NativeChatThreadScreen conversationId={change === 'conversation' ? 'conversation-2' : 'conversation-1'} />);
    await act(async () => { finish({ ...focusedPage, items: [{
      id: 'stale-focused-page', conversation_id: 'conversation-1', sender_user_id: 2,
      body_text: 'Stale focused page', created_at: '2026-08-23T07:00:00Z',
    }] }); });
    expect(view.queryByText('Stale focused page')).toBeNull();
  });

  it.each(['older', 'newer', 'latest'])('ignores late %s pagination after changing conversation', async (direction) => {
    const base = await mockedChatApi.getMessagesPage('conversation-1');
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({ ...base,
      has_older: direction === 'older', has_newer: direction !== 'older',
      older_cursor_message_id: 'message-1', newer_cursor_message_id: 'message-1',
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    let finish!: (page: typeof base) => void;
    mockedChatApi.getMessagesPage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    if (direction === 'older') await fireEvent(view.getByTestId('native-chat-message-list'), 'onEndReached');
    else if (direction === 'latest') await fireEvent.press(view.getByLabelText('Перейти к последним сообщениям'));
    else await fireEvent.scroll(view.getByTestId('native-chat-message-list'), {
      nativeEvent: { contentOffset: { y: 0 } },
    });
    expect(finish).toBeDefined();
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
    await act(async () => { finish({ ...base, items: [{
      id: 'stale-pagination', conversation_id: 'conversation-1', sender_user_id: 2,
      body_text: 'Stale pagination page', created_at: '2026-08-23T07:00:00Z',
    }] }); });
    expect(view.queryByText('Stale pagination page')).toBeNull();
  });

  it('shows an explicit empty state after a completed message search', async () => {
    mockedChatApi.searchMessages.mockResolvedValueOnce([]);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Поиск в диалоге'));
    await fireEvent.changeText(view.getByLabelText('Поиск сообщений в диалоге'), 'нет такого');
    await fireEvent.press(view.getByLabelText('Найти сообщения'));

    await waitFor(() => expect(view.getByText('По вашему запросу ничего не найдено')).toBeTruthy());
  });

  it('forwards a message to a selected conversation', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение', 'Переслать');
    await fireEvent.press(view.getByLabelText('Переслать'));
    await waitFor(() => expect(view.getByLabelText('Переслать в Мария Иванова')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Переслать в Мария Иванова'));

    await waitFor(() => expect(mockedChatApi.forwardMessage).toHaveBeenCalledWith(
      'conversation-1',
      'message-1',
    ));
  });

  it('keeps acknowledged forwards visible and retries only the remaining messages', async () => {
    mockedChatApi.forwardMessage.mockImplementationOnce(async (_target, source) => ({
      id: 'forward-ack-1', conversation_id: 'conversation-1', sender_user_id: 1,
      body_text: `Подтверждённая пересылка ${source}`, created_at: '2026-08-23T09:00:00Z',
    })).mockRejectedValueOnce(new Error('Synthetic timeout'))
      .mockResolvedValueOnce({ id: 'forward-ack-2', conversation_id: 'conversation-1', sender_user_id: 1,
        body_text: 'Подтверждённый остаток', created_at: '2026-08-23T09:01:00Z' });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение', 'Выбрать');
    await fireEvent.press(view.getByLabelText('Выбрать'));
    await fireEvent.press(view.getByText('Второе сообщение'));
    await fireEvent.press(view.getByLabelText('Переслать'));
    await fireEvent.press(await view.findByLabelText('Переслать в Мария Иванова'));
    await waitFor(() => expect(mockedChatApi.forwardMessage).toHaveBeenCalledTimes(2));
    expect(await view.findByText('Подтверждено: 1 из 2. Осталось: 1.')).toBeTruthy();
    const firstSource = mockedChatApi.forwardMessage.mock.calls[0][1];
    expect(view.getByText(`Подтверждённая пересылка ${firstSource}`)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Переслать в Мария Иванова'));
    await waitFor(() => expect(mockedChatApi.forwardMessage).toHaveBeenCalledTimes(3));
    expect(mockedChatApi.forwardMessage.mock.calls[2][1]).toBe(mockedChatApi.forwardMessage.mock.calls[1][1]);
    expect(mockedChatApi.forwardMessage.mock.calls.filter((call) => call[1] === firstSource)).toHaveLength(1);
    expect(await view.findByText('Подтверждённый остаток')).toBeTruthy();
  });

  it('serializes a forward batch, blocks dismissal while pending and shows every acknowledgement', async () => {
    let finishFirst!: (value: Awaited<ReturnType<typeof chatApi.forwardMessage>>) => void;
    mockedChatApi.forwardMessage.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ id: 'batch-second', conversation_id: 'conversation-1', sender_user_id: 1,
        body_text: 'Вторая доставка пачки', created_at: '2026-08-23T09:01:00Z' });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await openMessageActions(view, 'Первое сообщение', 'Выбрать');
    await fireEvent.press(view.getByLabelText('Выбрать'));
    await fireEvent.press(view.getByText('Второе сообщение'));
    await fireEvent.press(view.getByLabelText('Переслать'));
    const target = await view.findByLabelText('Переслать в Мария Иванова');
    const click = target.props.onClick;
    const event = { nativeEvent: {}, currentTarget: 1, target: 1, stopPropagation: jest.fn() };
    await act(async () => { click(event); click(event); });
    expect(mockedChatApi.forwardMessage).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('Отмена'));
    expect(view.getByLabelText('Переслать в Мария Иванова').props.accessibilityState.disabled).toBe(true);
    await act(async () => finishFirst({ id: 'batch-first', conversation_id: 'conversation-1', sender_user_id: 1,
      body_text: 'Первая доставка пачки', created_at: '2026-08-23T09:00:00Z' }));
    await waitFor(() => expect(mockedChatApi.forwardMessage).toHaveBeenCalledTimes(2));
    expect(await view.findByText('Первая доставка пачки')).toBeTruthy();
    expect(view.getByText('Вторая доставка пачки')).toBeTruthy();
    expect(view.queryByLabelText('Переслать в Мария Иванова')).toBeNull();
  });

  it('picks and uploads a document through the native attachment flow', async () => {
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue([{
      uri: 'file:///cache/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 256,
      source: 'document',
    }]);
    jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Файл'));

    await waitFor(() => expect(mockedChatApi.sendFileMessage).toHaveBeenCalledWith(
      'conversation-1',
      expect.any(FormData),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ));
  });

  it.each(['Quoted message not found', 'Conversation not found'])('keeps attachments during reply recovery: %s', async (detail) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue([{
      uri: 'file:///cache/report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 256, source: 'document',
    }]);
    const build = jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    mockedChatApi.sendFileMessage.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: { detail } } });
    try {
      const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
      await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
      await openMessageActions(view, 'Первое сообщение', 'Ответить');
      await fireEvent.press(view.getByLabelText('Ответить'));
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Подпись ответа с файлом');
      await fireEvent.press(view.getByLabelText('Добавить вложение'));
      await fireEvent.press(view.getByLabelText('Файл'));
      await waitFor(() => expect(mockedChatApi.sendFileMessage).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(view.getByLabelText('Текст сообщения').props.value).toBe(''));
      if (detail !== 'Quoted message not found') {
        expect(alert).not.toHaveBeenCalledWith('Исходное сообщение недоступно', expect.anything(), expect.anything());
        return;
      }
      await waitFor(() => expect(alert).toHaveBeenCalledWith('Исходное сообщение недоступно', expect.any(String), expect.any(Array)));
      const firstFiles = build.mock.calls[0][0];
      await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'Новый черновик');
      const action = alert.mock.calls.find(([title]) => title === 'Исходное сообщение недоступно')?.[2]?.find((button) => button.text === 'Отправить без цитаты');
      await act(async () => { action?.onPress?.(); });
      await waitFor(() => expect(mockedChatApi.sendFileMessage).toHaveBeenCalledTimes(2));
      expect(build.mock.calls[1][0]).toEqual(firstFiles);
      expect(build.mock.calls[1][1]).toMatchObject({ body: 'Подпись ответа с файлом', replyToMessageId: undefined });
      expect(build.mock.calls[1][1]?.clientMessageId).not.toBe(build.mock.calls[0][1]?.clientMessageId);
      expect(view.getByLabelText('Текст сообщения').props.value).toBe('Новый черновик');
    } finally { alert.mockRestore(); }
  });

  it('previews several files and sends them as one message with a caption', async () => {
    const files = [{
      uri: 'file:///cache/one.jpg',
      name: 'one.jpg',
      mimeType: 'image/jpeg',
      size: 100,
      source: 'document' as const,
    }, {
      uri: 'file:///cache/two.pdf',
      name: 'two.pdf',
      mimeType: 'application/pdf',
      size: 200,
      source: 'document' as const,
    }];
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue(files);
    const build = jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Файл'));
    await waitFor(() => expect(view.getByText('Выбрано файлов: 2')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Подпись к вложениям'), 'Материалы');
    await fireEvent.press(view.getByLabelText('Отправить вложения'));

    await waitFor(() => expect(build).toHaveBeenCalledWith(files, expect.objectContaining({
      body: 'Материалы',
      clientMessageId: expect.stringMatching(/^mobile-/),
    })));
    await waitFor(() => expect(mockedChatApi.sendFileMessage).toHaveBeenCalledTimes(1));
  });

  it('keeps a single photo caption in the offline queue and sends both on reconnect', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
      success?.(1200, 800);
      return Promise.resolve({ width: 1200, height: 800 });
    });
    const photo = { uri: 'file:///caption.png', name: 'caption.png', mimeType: 'image/png', size: 123, source: 'gallery' as const };
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue([photo]);
    const build = jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    mockOfflineMode = true;
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Фото из галереи'));
    await waitFor(() => expect(view.getByLabelText('Подпись к фото')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Подпись к фото'), 'Фото оборудования');
    await fireEvent.press(view.getByLabelText('Отправить фото'));
    const queue = require('../../chat/nativeChatOutbox') as typeof import('../../chat/nativeChatOutbox');
    await waitFor(async () => expect((await queue.readNativeChatOutbox(1))[0]?.upload).toEqual(
      expect.objectContaining({ body: 'Фото оборудования', files: [photo] }),
    ));
    expect(mockedChatApi.sendFileMessage).not.toHaveBeenCalled();
    mockOfflineMode = false;
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(build).toHaveBeenCalledWith([photo], expect.objectContaining({ body: 'Фото оборудования' })));
    expect(mockedChatApi.sendFileMessage).toHaveBeenCalledTimes(1);
  });

  it('edits one photo in a group without sending it or losing the group caption', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
      success?.(1200, 800); return Promise.resolve({ width: 1200, height: 800 });
    });
    const files = [
      { uri: 'file:///one.png', name: 'one.png', mimeType: 'image/png', size: 123, source: 'gallery' as const },
      { uri: 'file:///two.jpg', name: 'two.jpg', mimeType: 'image/jpeg', size: 456, source: 'gallery' as const },
    ];
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue(files);
    const build = jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    jest.spyOn(require('expo-image-manipulator'), 'manipulateAsync').mockResolvedValueOnce({ uri: 'file:///edited-one.jpg', width: 800, height: 1200 });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Фото из галереи'));
    await waitFor(() => expect(view.getByText('Выбрано файлов: 2')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Подпись к вложениям'), 'Комплект');
    await fireEvent.press(view.getByLabelText('Редактировать one.png'));
    expect(view.getByLabelText('Подпись к фото').props.value).toBe('Комплект');
    await fireEvent.press(view.getByLabelText('Повернуть на 90 градусов'));
    await waitFor(() => expect(view.getByLabelText('Отменить').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('Сохранить фото'));
    expect(mockedChatApi.sendFileMessage).not.toHaveBeenCalled();
    expect(view.getByLabelText('Подпись к вложениям').props.value).toBe('Комплект');
    await fireEvent.press(view.getByLabelText('Отправить вложения'));
    await waitFor(() => expect(build).toHaveBeenCalledWith([
      expect.objectContaining({ uri: 'file:///edited-one.jpg', name: 'one.jpg', mimeType: 'image/jpeg' }), files[1],
    ], expect.objectContaining({ body: 'Комплект' })));
  });

  it('keeps the single photo and caption when durable file preparation fails', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
      success?.(1200, 800); return Promise.resolve({ width: 1200, height: 800 });
    });
    const storage = require('../../chat/nativeChatDraftFiles');
    jest.spyOn(storage, 'persistNativeChatDraftFiles').mockRejectedValueOnce(new Error('disk full'));
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue([
      { uri: 'file:///one.png', name: 'one.png', mimeType: 'image/png', size: 123, source: 'gallery' },
    ]);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Фото из галереи'));
    await waitFor(() => expect(view.getByLabelText('Подпись к фото')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Подпись к фото'), 'Не потерять подпись');
    await fireEvent.press(view.getByLabelText('Отправить фото'));
    await waitFor(() => expect(view.getByLabelText('Подпись к фото').props.editable).toBe(true));
    expect(view.getByLabelText('Подпись к фото').props.value).toBe('Не потерять подпись');
    expect(mockedChatApi.sendFileMessage).not.toHaveBeenCalled();
  });

  it('reuses the same client message id when a multi-file upload is retried', async () => {
    const files = [{
      uri: 'file:///cache/one.pdf',
      name: 'one.pdf',
      mimeType: 'application/pdf',
      size: 100,
      source: 'document' as const,
    }, {
      uri: 'file:///cache/two.pdf',
      name: 'two.pdf',
      mimeType: 'application/pdf',
      size: 200,
      source: 'document' as const,
    }];
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue(files);
    const build = jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    mockedChatApi.sendFileMessage
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({
        id: 'message-files-retry',
        conversation_id: 'conversation-1',
        sender_user_id: 1,
        is_own: true,
        attachments: [],
      });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Файл'));
    await waitFor(() => expect(view.getByText('Выбрано файлов: 2')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Отправить вложения'));
    await waitFor(() => expect(view.getByLabelText('Повторить: one.pdf')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Повторить: one.pdf'));

    await waitFor(() => expect(build).toHaveBeenCalledTimes(2));
    const firstId = build.mock.calls[0][1]?.clientMessageId;
    const secondId = build.mock.calls[1][1]?.clientMessageId;
    expect(firstId).toBeTruthy();
    expect(secondId).toBe(firstId);
  });

  it('keeps a sent attachment on the own side even if the server echo says is_own false', async () => {
    mockedChatApi.sendFileMessage.mockResolvedValue({
      id: 'message-file',
      conversation_id: 'conversation-1',
      sender_user_id: 1,
      sender: { id: 1, username: 'mobile-user', full_name: 'Мобильный пользователь' },
      body_text: '',
      is_own: false,
      attachments: [{ id: 'attachment-1', file_name: 'report.pdf' }],
    });
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue([{
      uri: 'file:///cache/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 256,
      source: 'document',
    }]);
    jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Файл'));

    await waitFor(() => expect(view.getAllByLabelText(/Ваше сообщение/).length).toBeGreaterThan(0));
    expect(view.queryByLabelText(/Сообщение от Мобильный пользователь/)).toBeNull();
  });

  it('shows an optimistic file card and cancels its upload from the bubble', async () => {
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue([{
      uri: 'file:///cache/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 256,
      source: 'document',
    }]);
    jest.spyOn(nativeFilePicker, 'buildAttachmentsFormData').mockReturnValue(new FormData());
    mockedChatApi.sendFileMessage.mockImplementationOnce((_conversationId, _formData, options) => (
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject({ name: 'AbortError' }));
      })
    ));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Файл'));

    await waitFor(() => expect(view.getByText('report.pdf')).toBeTruthy());
    await waitFor(() => expect(view.getByText('Отправка 0%')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Отменить: report.pdf'));

    await waitFor(() => expect(view.getByText('Отправка отменена')).toBeTruthy());
    expect(view.getByLabelText('Повторить: report.pdf')).toBeTruthy();
    expect(mockedChatApi.sendFileMessage.mock.calls[0][2]?.signal?.aborted).toBe(true);
  });

  it('shows Telegram-like folder tabs in the inbox', async () => {
    const view = await render(<NativeChatInboxScreen />);

    await waitFor(() => expect(view.getByLabelText(/Папка Личные/)).toBeTruthy());
    expect(view.getByLabelText(/Папка Непрочитанные/)).toBeTruthy();
    expect(view.getByLabelText(/Папка Беседы/)).toBeTruthy();
    expect(view.getByLabelText(/Папка Задачи/)).toBeTruthy();
    expect(view.getByLabelText(/Папка Работа/)).toBeTruthy();
    expect(view.getByLabelText(/Папка Архив/)).toBeTruthy();
    expect(view.getByLabelText('Чаты')).toBeTruthy();
    expect(view.getByLabelText('ИИ')).toBeTruthy();
  });

  it('moves AI conversations into the dedicated ИИ workspace', async () => {
    mockedChatApi.getConversationPage.mockResolvedValue({
      items: [
        {
          id: 'conversation-1',
          kind: 'direct',
          title: 'Мария Иванова',
          last_message_preview: 'Привет',
        },
        {
          id: 'ai-today',
          kind: 'ai',
          title: 'HUB Ассистент',
          last_message_preview: '**Готово**',
          last_message_at: new Date().toISOString(),
          unread_count: 1,
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    const view = await render(<NativeChatInboxScreen />);
    await waitFor(() => expect(view.getByText('Мария Иванова')).toBeTruthy());
    expect(view.queryByText('HUB Ассистент')).toBeNull();

    await fireEvent.press(view.getByRole('tab', { name: /ИИ/ }));
    await waitFor(() => expect(view.getByText('HUB Ассистент')).toBeTruthy());
    expect(view.getByText('Сегодня')).toBeTruthy();
    expect(view.getByText('Готово')).toBeTruthy();
    expect(view.queryByLabelText(/Папка Личные/)).toBeNull();
    expect(view.getByLabelText('Новый AI-чат')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Новый AI-чат'));
    await waitFor(() => expect(view.getByText('Новый AI-чат')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть HUB Ассистент'));
    await waitFor(() => expect(mockedChatApi.createAiConversation).toHaveBeenCalled());
  });

  it('renders markdown message bodies in the native thread', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-md',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: 'Проверь **отчёт**',
        body_format: 'markdown',
        created_at: '2026-08-23T08:00:00Z',
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByTestId('chat-markdown-body')).toBeTruthy());
    expect(view.getByText('отчёт')).toBeTruthy();
  });

  it('selects a message on long press and adds the next tap', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent(view.getByText('Первое сообщение'), 'longPress');
    await waitFor(() => expect(view.getByLabelText('Готово')).toBeTruthy());
    await fireEvent.press(view.getByText('Второе сообщение'));
    expect(view.getByText('2')).toBeTruthy();
    expect(view.getByLabelText('Переслать')).toBeTruthy();
  });

  it('opens an in-app photo viewer instead of the system alert', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-photo',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: '',
        created_at: '2026-08-23T08:00:00Z',
        attachments: [{
          id: 'attachment-photo',
          kind: 'image',
          file_name: 'photo.jpg',
          mime_type: 'image/jpeg',
          preview_url: 'https://hubit.zsgp.ru/files/photo.jpg',
        }],
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    await waitFor(() => expect(view.getByLabelText('Открыть фото photo.jpg')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть фото photo.jpg'));
    expect(view.getByLabelText('Закрыть просмотр')).toBeTruthy();
    expect(view.getByLabelText('Открыть')).toBeTruthy();
    expect(view.getByLabelText('Поделиться')).toBeTruthy();
    expect(view.getByLabelText('Переслать')).toBeTruthy();
    expect(view.getByLabelText('В «Мои файлы»')).toBeTruthy();
  });

  it('opens file actions in the HUB sheet and dismisses it from the empty backdrop', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-document',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: '',
        created_at: '2026-08-23T08:00:00Z',
        attachments: [{
          id: 'attachment-document',
          kind: 'file',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
          download_url: '/api/v1/chat/messages/message-document/attachments/attachment-document/file',
        }],
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

    const file = await waitFor(() => view.getByLabelText(/Открыть файл report\.pdf/));
    await fireEvent.press(file);
    expect(view.getAllByText('report.pdf')).toHaveLength(2);
    expect(view.getByLabelText('Сохранить в «Мои файлы»')).toBeTruthy();

    await fireEvent.press(view.getByTestId('chat-attachment-actions-backdrop'));
    await waitFor(() => expect(view.queryByLabelText('Сохранить в «Мои файлы»')).toBeNull());
  });

  it('asks the server for inbox search instead of filtering only the loaded page', async () => {
    mockedChatApi.getConversationPage.mockImplementation(async (options = {}) => {
      if (options.query) {
        return {
          items: [{
            id: 'conversation-search',
            kind: 'direct',
            title: 'Складской чат',
            last_message_preview: 'коробки',
          }],
          has_more: false,
          next_cursor: null,
        };
      }
      return {
        items: [{
          id: 'conversation-1',
          kind: 'direct',
          title: 'Мария Иванова',
          last_message_preview: 'Привет',
          unread_count: 2,
        }],
        has_more: false,
        next_cursor: null,
      };
    });
    const view = await render(<NativeChatInboxScreen />);
    await waitFor(() => expect(view.getByText('Мария Иванова')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Поиск чатов'), 'склад');

    await waitFor(() => expect(mockedChatApi.getConversationPage).toHaveBeenCalledWith({
      query: 'склад',
      limit: 50,
    }));
    await waitFor(() => expect(mockedChatApi.searchMessagesGlobal).toHaveBeenCalledWith('склад', 20));
    await waitFor(() => expect(view.getByText('Складской чат')).toBeTruthy());
  });

  it('opens a conversation from a global message search hit', async () => {
    mockedChatApi.searchMessagesGlobal.mockResolvedValue([{
      conversation_id: 'conversation-search',
      conversation_title: 'Складской чат',
      message_id: 'message-42',
      sender_name: 'Мария',
      preview: 'коробки на полке',
    }]);
    const view = await render(<NativeChatInboxScreen />);
    await waitFor(() => expect(view.getByText('Мария Иванова')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Поиск чатов'), 'коробки');
    await waitFor(() => expect(view.getByText('Мария: коробки на полке')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Сообщение в Складской чат'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'conversation-search', messageId: 'message-42' },
    });
  });

  it('creates a custom folder from the inbox manager', async () => {
    const view = await render(<NativeChatInboxScreen />);
    await waitFor(() => expect(view.getByLabelText(/Папка Работа/)).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Управление папками'));
    await fireEvent.press(view.getByLabelText('Создать папку'));
    await fireEvent.changeText(view.getByLabelText('Название папки'), 'Склад');
    await fireEvent.press(view.getByLabelText('Создать'));

    await waitFor(() => expect(mockedChatApi.createChatFolder).toHaveBeenCalledWith('Склад'));
  });

  it('assigns a conversation to a custom folder from a long press', async () => {
    const view = await render(<NativeChatInboxScreen />);
    await waitFor(() => expect(view.getByText('Мария Иванова')).toBeTruthy());
    await fireEvent(view.getByLabelText(/^Мария Иванова/), 'longPress');
    await fireEvent.press(view.getByLabelText('Добавить в папку'));
    await waitFor(() => expect(view.getByText('Добавить в папку')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Работа'));

    await waitFor(() => expect(mockedChatApi.addFolderConversation).toHaveBeenCalledWith(
      'work',
      'conversation-1',
    ));
  });

  it('offers the main conversation actions from a long press', async () => {
    const view = await render(<NativeChatInboxScreen />);
    await waitFor(() => expect(view.getByText('Мария Иванова')).toBeTruthy());

    await fireEvent(view.getByLabelText(/^Мария Иванова/), 'longPress');

    expect(view.getByLabelText('Закрепить')).toBeTruthy();
    expect(view.getByLabelText('Выключить уведомления')).toBeTruthy();
    expect(view.getByLabelText('Архивировать')).toBeTruthy();
    expect(view.getByLabelText('Добавить в папку')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Закрепить'));
    await waitFor(() => expect(mockedChatApi.updateConversationSettings).toHaveBeenCalledWith(
      'conversation-1',
      { is_pinned: true },
    ));
  });

  it('shows notes, task and AI as separate kinds in the inbox', async () => {
    mockedChatApi.getConversationPage.mockResolvedValue({
      items: [{
        id: 'conversation-task',
        kind: 'task',
        title: 'Заявка на принтер',
        last_message_preview: 'Нужно заменить',
      }],
      has_more: false,
      next_cursor: null,
    });
    const view = await render(<NativeChatInboxScreen />);
    await fireEvent.press(view.getByLabelText(/Папка Задачи/));
    await waitFor(() => expect(view.getByText('Заявка на принтер')).toBeTruthy());
    expect(view.getByText('Задача')).toBeTruthy();
  });

  it('pages between neighbouring photos in the in-app viewer', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-photo-1',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: '',
        created_at: '2026-08-23T08:00:00Z',
        attachments: [{
          id: 'attachment-photo-1',
          kind: 'image',
          file_name: 'first.jpg',
          mime_type: 'image/jpeg',
          preview_url: 'https://hubit.zsgp.ru/files/first.jpg',
        }],
      }, {
        id: 'message-photo-2',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'ivan', full_name: 'Иван' },
        body_text: '',
        created_at: '2026-08-23T08:10:00Z',
        attachments: [{
          id: 'attachment-photo-2',
          kind: 'image',
          file_name: 'second.jpg',
          mime_type: 'image/jpeg',
          preview_url: 'https://hubit.zsgp.ru/files/second.jpg',
        }],
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Открыть фото first.jpg')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть фото first.jpg'));
    expect(view.getByText('2 / 2')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Предыдущее фото'));
    await waitFor(() => expect(view.getByText('1 / 2')).toBeTruthy());
    expect(view.getByLabelText('Следующее фото')).toBeTruthy();
  });

  it('opens a conversation gallery photo from the info sheet', async () => {
    mockedChatApi.getConversationAttachments.mockResolvedValue({
      items: [{
        id: 'gallery-1',
        message_id: 'message-gallery',
        kind: 'image',
        file_name: 'gallery.jpg',
        preview_url: 'https://hubit.zsgp.ru/files/gallery.jpg',
      }],
      has_more: false,
      next_before_attachment_id: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Информация о чате Мария Иванова')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Информация о чате Мария Иванова'));
    await waitFor(() => expect(view.getByLabelText('Открыть фото gallery.jpg')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть фото gallery.jpg'));
    expect(view.getByLabelText('Закрыть просмотр')).toBeTruthy();
  });

  it('switches conversation gallery tabs in the info sheet', async () => {
    mockedChatApi.getConversationAttachments.mockImplementation(async (_id, options = {}) => {
      if (options.kind === 'video') {
        return {
          items: [{
            id: 'gallery-video',
            message_id: 'message-video',
            kind: 'video',
            file_name: 'clip.mp4',
            preview_url: 'https://hubit.zsgp.ru/files/clip.jpg',
          }],
          has_more: true,
          next_before_attachment_id: 'gallery-video',
        };
      }
      if (options.kind === 'file') {
        return { items: [], has_more: false, next_before_attachment_id: null };
      }
      return {
        items: [{
          id: 'gallery-1',
          message_id: 'message-gallery',
          kind: 'image',
          file_name: 'gallery.jpg',
          preview_url: 'https://hubit.zsgp.ru/files/gallery.jpg',
        }],
        has_more: false,
        next_before_attachment_id: null,
      };
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Информация о чате Мария Иванова')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Информация о чате Мария Иванова'));
    await waitFor(() => expect(view.getByLabelText('Открыть фото gallery.jpg')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Галерея Видео'));
    await waitFor(() => expect(view.getByLabelText('Открыть видео clip.mp4')).toBeTruthy());
    expect(view.getByLabelText('Загрузить ещё медиа')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Галерея Файлы'));
    await waitFor(() => expect(view.getByText('Нет файлов')).toBeTruthy());
  });

  it('sends typing over the existing socket when the composer changes', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'печатаю');
    expect(chatSocket.sendTyping).toHaveBeenCalledWith('conversation-1', true);
  });

  it('records and sends a voice note through the existing files endpoint', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Записать голосовое')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Записать голосовое'));
    await waitFor(() => expect(view.getByLabelText(/Запись голосового сообщения/)).toBeTruthy());
    expect(view.getByTestId('chat-voice-recording-waveform', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Отправить голосовое'));

    await waitFor(() => expect(mockedChatApi.sendFileMessage).toHaveBeenCalledWith(
      'conversation-1',
      expect.any(FormData),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ));
  });

  it('renders a Telegram-like voice waveform in the thread', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-voice',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: '',
        created_at: '2026-08-23T08:00:00Z',
        attachments: [{
          id: 'attachment-voice',
          kind: 'audio',
          file_name: 'voice_1.m4a',
          mime_type: 'audio/mp4',
          duration_seconds: 12,
        }],
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Воспроизвести голосовое сообщение 0:12')).toBeTruthy());
    expect(view.getByLabelText('Прогресс воспроизведения')).toBeTruthy();
    expect(view.getAllByTestId('chat-voice-bar', { includeHiddenElements: true }).length).toBe(32);
  });

  it('opens message actions on the first tap without waiting for a double-tap window', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    await fireEvent.press(view.getByText('Первое сообщение'));
    expect(view.getByLabelText('Ответить')).toBeTruthy();
  });

  it('adds a quick reaction on double tap', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    const bubble = view.getByLabelText(/Сообщение от Мария Иванова\. Первое сообщение/);
    await fireEvent.press(bubble);
    await fireEvent.press(bubble);

    await waitFor(() => expect(mockedChatApi.toggleReaction).toHaveBeenCalledWith(
      'conversation-1',
      'message-1',
      '👍',
    ));
  });

  it('shows a sender avatar next to incoming bubbles in a group', async () => {
    mockedChatApi.getConversation.mockResolvedValue({
      id: 'conversation-1',
      kind: 'group',
      title: 'Отдел IT',
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());

    // The avatar is decorative: the bubble label already names the sender.
    expect(view.getAllByText('МИ', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  });

  it('keeps sender avatars out of direct conversations', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());

    // Only the header avatar for the peer, never one per bubble.
    expect(view.getAllByText('МИ', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('keeps inbox search global and does not hide results by the active folder', async () => {
    mockedChatApi.getConversationPage.mockImplementation(async (options = {}) => {
      if (options.query) {
        return {
          items: [{
            id: 'conversation-group',
            kind: 'group',
            title: 'Складская беседа',
            last_message_preview: 'коробки',
          }],
          has_more: false,
          next_cursor: null,
        };
      }
      return {
        items: [{
          id: 'conversation-1',
          kind: 'direct',
          title: 'Мария Иванова',
          last_message_preview: 'Привет',
        }],
        has_more: false,
        next_cursor: null,
      };
    });
    const view = await render(<NativeChatInboxScreen />);
    await waitFor(() => expect(view.getByText('Мария Иванова')).toBeTruthy());
    await fireEvent.press(view.getByLabelText(/Папка Личные/));
    await fireEvent.changeText(view.getByLabelText('Поиск чатов'), 'склад');

    await waitFor(() => expect(view.getByText('Складская беседа')).toBeTruthy());
  });

  it('sends a GIF from the emoji sheet through the files endpoint', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Открыть эмодзи')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть эмодзи'));
    await fireEvent.press(view.getByLabelText('GIF'));
    await waitFor(() => expect(view.getByLabelText('Отправить GIF кот')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Отправить GIF кот'));

    await waitFor(() => expect(mockedChatApi.sendFileMessage).toHaveBeenCalledWith(
      'conversation-1',
      expect.any(FormData),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ));
  });

  it('searches the native emoji catalog and opens stickers from the same sheet', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Открыть эмодзи')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть эмодзи'));
    await fireEvent.changeText(view.getByLabelText('Поиск эмодзи'), 'еда');
    expect(view.getByText('🍕 Еда')).toBeTruthy();
    expect(view.queryByText('😀 Смайлы')).toBeNull();
    await fireEvent.press(view.getByLabelText('Стикеры'));
    await waitFor(() => expect(mockedChatApi.getStickerPacks).toHaveBeenCalled());
    expect(view.getByText('Офис')).toBeTruthy();
    expect(view.getByLabelText('Закрыть стикеры')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Закрыть стикеры'));
    await waitFor(() => expect(view.queryByText('Офис')).toBeNull());
  });

  it('closes the sticker sheet immediately while the selected sticker is sending', async () => {
    let completeSend: ((value: Awaited<ReturnType<typeof chatApi.sendSticker>>) => void) | undefined;
    mockedChatApi.sendSticker.mockImplementationOnce(() => new Promise((resolve) => {
      completeSend = resolve;
    }));
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Открыть эмодзи')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть эмодзи'));
    await fireEvent.press(view.getByLabelText('Стикеры'));
    await waitFor(() => expect(view.getByLabelText('Отправить стикер 📎')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Отправить стикер 📎'));

    expect(mockedChatApi.sendSticker).toHaveBeenCalledWith('conversation-1', 'sticker-1', undefined);
    expect(view.queryByText('Офис')).toBeNull();

    await act(async () => {
      completeSend?.({
        id: 'sent-sticker',
        conversation_id: 'conversation-1',
        sender_user_id: 1,
        body_text: '',
        created_at: '2026-08-23T08:00:00Z',
        attachments: [],
      });
      await Promise.resolve();
    });
  });

  it.each(['sticker', 'task'])('ignores a late %s acknowledgement after changing conversation', async (kind) => {
    let finish!: (message: Awaited<ReturnType<typeof chatApi.sendSticker>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof chatApi.sendSticker>>>((resolve) => { finish = resolve; });
    if (kind === 'sticker') mockedChatApi.sendSticker.mockReturnValueOnce(pending);
    else mockedChatApi.shareTask.mockReturnValueOnce(pending);
    mockedChatApi.getShareableTasks.mockResolvedValue([{ id: 'task-1', title: 'Test task' }]);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
    if (kind === 'sticker') {
      await fireEvent.press(view.getByLabelText('Открыть эмодзи'));
      await fireEvent.press(view.getByLabelText('Стикеры'));
      await fireEvent.press(await view.findByLabelText('Отправить стикер 📎'));
    } else {
      await fireEvent.press(view.getByLabelText('Добавить вложение'));
      await fireEvent.press(view.getByLabelText('Отправить задачу'));
      await fireEvent.press(await view.findByLabelText('Отправить задачу Test task'));
    }
    await view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
    await act(async () => { finish({
      id: 'stale-special-send', conversation_id: 'conversation-1', sender_user_id: 1,
      body_text: 'Stale special send', created_at: '2026-08-23T08:00:00Z',
    }); });
    expect(view.queryByText('Stale special send')).toBeNull();
  });

  it('renders a sticker image instead of the attachment file name', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-sticker',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: '',
        created_at: '2026-08-23T08:00:00Z',
        attachments: [{
          id: 'sticker-1',
          kind: 'file',
          media_kind: 'sticker',
          file_name: 'sticker-office.tgs',
          mime_type: 'application/x-tgsticker',
          preview_url: '/api/v1/chat/stickers/sticker-1/preview',
        }],
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Стикер sticker-office.tgs')).toBeTruthy());
    expect(view.queryByText('📎 sticker-office.tgs')).toBeNull();
  });

  it('opens a group participant profile from the conversation info sheet', async () => {
    mockedChatApi.getConversation.mockResolvedValue({
      id: 'conversation-1',
      kind: 'group',
      title: 'Отдел IT',
      viewer_member_role: 'member',
      members: [{
        member_role: 'owner',
        user: {
          id: 2,
          username: 'maria',
          full_name: 'Мария Иванова',
          job_title: 'Инженер',
          department: 'ИТ',
          city: 'Москва',
          corporate_email: 'maria@example.com',
          corporate_phone: '+7 000',
          presence: { status: 'online', is_online: true },
        },
      }],
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Информация о чате Отдел IT')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Информация о чате Отдел IT'));
    await waitFor(() => expect(view.getByLabelText('Открыть карточку Мария Иванова')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Открыть карточку Мария Иванова'));
    expect(view.getByText('maria@example.com')).toBeTruthy();
    expect(view.getByText('+7 000')).toBeTruthy();
    expect(view.getByText('Москва')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Закрыть профиль'));
    await waitFor(() => expect(view.queryByText('maria@example.com')).toBeNull());
  });

  it('shows a link preview card for a message with a URL', async () => {
    mockedChatApi.getLinkPreview.mockResolvedValue({
      url: 'https://example.com/docs',
      title: 'Документация',
      description: 'Раздел Chat',
      site_name: 'HUB-IT',
    });
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-link',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: 'Смотри https://example.com/docs',
        created_at: '2026-08-23T08:00:00Z',
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(mockedChatApi.getLinkPreview).toHaveBeenCalledWith('https://example.com/docs'));
    await waitFor(() => expect(view.getByLabelText('Открыть ссылку Документация')).toBeTruthy());
  });

  it('imports a Telegram sticker pack through the existing Chat API', async () => {
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Добавить вложение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Открыть стикеры'));
    await waitFor(() => expect(view.getByLabelText('Ссылка на набор стикеров')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Ссылка на набор стикеров'), 'https://t.me/addstickers/cats');
    await fireEvent.press(view.getByLabelText('Добавить набор'));
    await waitFor(() => expect(mockedChatApi.importStickerPack).toHaveBeenCalledWith(
      'https://t.me/addstickers/cats',
    ));
  });

  it('opens the photo editor with draw, text and blur tools', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
      success?.(1200, 800);
    });
    jest.spyOn(nativeFilePicker, 'pickNativeAttachments').mockResolvedValue([{
      uri: 'file:///cache/photo.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      source: 'gallery',
    }]);
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Добавить вложение')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Добавить вложение'));
    await fireEvent.press(view.getByLabelText('Фото из галереи'));
    await waitFor(() => expect(view.getByLabelText('Рисовать')).toBeTruthy());
    expect(view.getByLabelText('Добавить текст')).toBeTruthy();
    expect(view.getByLabelText('Размыть')).toBeTruthy();
    expect(view.getByLabelText('Кадрировать')).toBeTruthy();
  });

  it('plays a video inside the media viewer instead of a placeholder', async () => {
    mockedChatApi.getMessagesPage.mockResolvedValueOnce({
      items: [{
        id: 'message-video',
        conversation_id: 'conversation-1',
        sender_user_id: 2,
        sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
        body_text: '',
        created_at: '2026-08-23T08:00:00Z',
        attachments: [{
          id: 'attachment-video',
          kind: 'video',
          file_name: 'clip.mp4',
          mime_type: 'video/mp4',
          preview_url: 'https://hubit.zsgp.ru/files/clip.jpg',
          download_url: 'https://hubit.zsgp.ru/files/clip.mp4',
        }],
      }],
      has_more: false,
      has_older: false,
      has_newer: false,
      cursor_invalid: false,
      older_cursor_message_id: null,
      newer_cursor_message_id: null,
      viewer_last_read_message_id: null,
      viewer_last_read_at: null,
    });
    const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
    await waitFor(() => expect(view.getByLabelText('Воспроизвести видео clip.mp4')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Воспроизвести видео clip.mp4'));
    expect(view.getByLabelText('Воспроизвести видео')).toBeTruthy();
    expect(view.getByTestId('chat-media-modal')).toBeTruthy();
  });

  it('renames an AI conversation from the ИИ workspace', async () => {
    mockedChatApi.getConversationPage.mockResolvedValue({
      items: [{
        id: 'ai-today',
        kind: 'ai',
        title: 'HUB Ассистент',
        last_message_preview: 'Готово',
        last_message_at: new Date().toISOString(),
      }],
      has_more: false,
      next_cursor: null,
    });
    const view = await render(<NativeChatInboxScreen />);
    await fireEvent.press(view.getByRole('tab', { name: /ИИ/ }));
    await waitFor(() => expect(view.getByText('HUB Ассистент')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Действия диалога HUB Ассистент'));
    await waitFor(() => expect(view.getByLabelText('Переименовать')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Переименовать'));
    await waitFor(() => expect(view.getByLabelText('Новое название диалога')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Новое название диалога'), 'Склад');
    await fireEvent.press(view.getByLabelText('Сохранить'));
    await waitFor(() => expect(mockedChatApi.renameAiConversation).toHaveBeenCalledWith('ai-today', 'Склад'));
  });

  it('blocks a revoked agent composer and preserves its draft when access returns', async () => {
    mockedChatApi.getConversation.mockResolvedValue({ id: 'ai-today', kind: 'ai', title: 'OpenCode' });
    const view = await render(<NativeChatThreadScreen conversationId="ai-today" />);
    await fireEvent.changeText(await view.findByLabelText('Текст сообщения'), 'Keep my draft');
    mockedChatApi.getAiConversationAccess.mockResolvedValue({ can_use: false });
    mockOfflineMode = true;
    await view.rerender(<NativeChatThreadScreen conversationId="ai-today" />);
    mockOfflineMode = false;
    await view.rerender(<NativeChatThreadScreen conversationId="ai-today" />);
    await waitFor(() => expect(view.getByText('Доступ к ИИ-агенту не предоставлен или отозван. История доступна, черновик не удалён.')).toBeTruthy());
    expect(view.queryByLabelText('Отправить сообщение')).toBeNull();
    expect(mockedChatApi.sendTextMessage).not.toHaveBeenCalled();
    mockedChatApi.getAiConversationAccess.mockResolvedValue({ can_use: true });
    mockOfflineMode = true;
    await view.rerender(<NativeChatThreadScreen conversationId="ai-today" />);
    mockOfflineMode = false;
    await view.rerender(<NativeChatThreadScreen conversationId="ai-today" />);
    await waitFor(() => expect(view.getByLabelText('Текст сообщения').props.value).toBe('Keep my draft'));
  });

  it('shows OpenCode and AI history actions in the conversation info sheet', async () => {
    mockedChatApi.getConversation.mockResolvedValue({
      id: 'ai-today',
      kind: 'ai',
      title: 'OpenCode',
    });
    mockedChatApi.getAiBots.mockResolvedValue([{
      id: 'opencode',
      name: 'OpenCode',
      surface: 'sandbox',
      conversation_ids: ['ai-today'],
    }]);
    mockedChatApi.getAiSandboxConversation.mockResolvedValue({
      enabled: true,
      job: { status: 'waiting_permission' },
      pending_permissions: [{ id: 'perm-1', title: 'Запись файла', reason: 'src/app.ts' }],
      files: [],
      diff: [],
    });
    const view = await render(<NativeChatThreadScreen conversationId="ai-today" />);
    await waitFor(() => expect(view.getByLabelText('Информация о чате OpenCode')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Информация о чате OpenCode'));
    await waitFor(() => expect(view.getByLabelText('Сбросить контекст')).toBeTruthy());
    expect(view.getByLabelText('Удалить чат')).toBeTruthy();
    expect(view.getByLabelText('Переименовать')).toBeTruthy();
    await waitFor(() => expect(view.getByText('OpenCode workspace')).toBeTruthy());
    expect(view.getByLabelText('Разрешить один раз')).toBeTruthy();
    expect(mockedChatApi.getAiSandboxConversation).toHaveBeenCalledWith('ai-today');
  });
});
