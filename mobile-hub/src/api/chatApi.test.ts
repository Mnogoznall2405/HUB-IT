import apiClient from './client';
import {
  addFolderConversation,
  createChatFolder,
  deleteChatFolder,
  getConversations,
  getConversationAttachments,
  getConversationPage,
  getUnreadSummary,
  getChatUsers,
  getMessagesPage,
  getMessageReads,
  getShareableTasks,
  getLinkPreview,
  getStickerPacks,
  getThreadBootstrap,
  importStickerPack,
  listChatFolders,
  markConversationRead,
  removeFolderConversation,
  searchMessagesGlobal,
  setPinnedMessage,
  saveAttachmentToMyFiles,
  sendSticker,
  shareTask,
  sendTextMessage,
  attachAiSandboxArchive,
  deleteAiConversation,
  getAiBots,
  getAiSandboxConversation,
  renameAiConversation,
  resetAiConversationContext,
  respondAiSandboxPermission,
  updateChatFolder,
  updateConversationSettings,
  resolveChatUser,
} from './chatApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedClient = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

describe('native Chat API contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes backend conversation summaries for the native inbox', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{
          id: 'conversation-1',
          kind: 'direct',
          title: 'Мария',
          unread_count: 3,
          last_message_seq: 18,
          direct_peer: { id: 7, username: 'maria', avatar_url: '/avatars/7' },
        }],
      },
    });

    await expect(getConversations()).resolves.toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        kind: 'direct',
        is_group: false,
        peer_user_id: 7,
        unread_count: 3,
        last_message_seq: 18,
      }),
    ]);
    expect(mockedClient.get).toHaveBeenCalledWith('/chat/conversations', {
      params: { q: undefined, cursor: undefined, limit: 50 },
    });
  });

  it('coalesces concurrent unread-summary requests during native bootstrap', async () => {
    let resolveRequest: ((value: { data: { messages_unread_total: number; conversations_unread: number } }) => void) | undefined;
    mockedClient.get.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const first = getUnreadSummary();
    const second = getUnreadSummary();

    expect(mockedClient.get).toHaveBeenCalledTimes(1);
    resolveRequest?.({ data: { messages_unread_total: 4, conversations_unread: 2 } });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { messages_unread_total: 4, conversations_unread: 2 },
      { messages_unread_total: 4, conversations_unread: 2 },
    ]);
  });

  it('preserves native inbox pagination metadata', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{ id: 'conversation-2', kind: 'group', title: 'Команда' }],
        has_more: true,
        next_cursor: 'cursor-2',
      },
    });

    await expect(getConversationPage({ cursor: 'cursor-1', limit: 25 })).resolves.toEqual({
      items: [expect.objectContaining({ id: 'conversation-2', kind: 'group' })],
      has_more: true,
      next_cursor: 'cursor-2',
    });
    expect(mockedClient.get).toHaveBeenCalledWith('/chat/conversations', {
      params: { q: undefined, cursor: 'cursor-1', limit: 25 },
    });
  });

  it('maps backend body and sender fields and preserves pagination metadata', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{
          id: 'message-1',
          conversation_id: 'conversation-1',
          conversation_seq: 4,
          body: 'Привет',
          sender: { id: 9, username: 'ivan', full_name: 'Иван' },
          created_at: '2026-08-23T08:00:00Z',
          reactions: [{ emoji: '👍', count: 2, user_ids: [7, 9] }],
        }],
        has_older: true,
        older_cursor_message_id: 'message-1',
      },
    });

    await expect(getMessagesPage('conversation-1', { beforeMessageId: 'message-8', limit: 40 }))
      .resolves.toEqual(expect.objectContaining({
        has_older: true,
        older_cursor_message_id: 'message-1',
        items: [expect.objectContaining({
          id: 'message-1',
          body_text: 'Привет',
          sender_user_id: 9,
          conversation_seq: 4,
        })],
      }));
    expect(mockedClient.get).toHaveBeenCalledWith(
      '/chat/conversations/conversation-1/messages',
      { params: { before_message_id: 'message-8', after_message_id: undefined, limit: 40 } },
    );
  });

  it('retries a transient overloaded message read once', async () => {
    jest.useFakeTimers();
    mockedClient.get
      .mockRejectedValueOnce({ response: { status: 503 }, isAxiosError: true })
      .mockResolvedValueOnce({ data: { items: [], has_older: false } });

    try {
      const pending = expect(getMessagesPage('conversation-1'))
        .resolves.toEqual(expect.objectContaining({ items: [] }));
      await jest.advanceTimersByTimeAsync(150);

      await pending;
      expect(mockedClient.get).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the actual backend payload names for send and mark-read', async () => {
    mockedClient.post
      .mockResolvedValueOnce({ data: {
        id: 'message-2',
        conversation_id: 'conversation-1',
        body: 'Ответ',
        sender: { id: 5, username: 'me' },
      } })
      .mockResolvedValueOnce({ data: { changed: true } });

    await sendTextMessage('conversation-1', 'Ответ', { clientMessageId: 'mobile-1' });
    await markConversationRead('conversation-1', 'message-2');

    expect(mockedClient.post).toHaveBeenNthCalledWith(1, '/chat/conversations/conversation-1/messages', {
      body: 'Ответ',
      body_format: 'plain',
      client_message_id: 'mobile-1',
      reply_to_message_id: undefined,
    });
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/chat/conversations/conversation-1/read', {
      message_id: 'message-2',
    });
  });

  it('sends markdown body_format when the text contains markdown', async () => {
    mockedClient.post.mockResolvedValueOnce({ data: {
      id: 'message-md',
      conversation_id: 'conversation-1',
      body: '## Inventory',
      sender: { id: 5, username: 'me' },
    } });

    await sendTextMessage('conversation-1', '## Inventory');

    expect(mockedClient.post).toHaveBeenCalledWith('/chat/conversations/conversation-1/messages', {
      body: '## Inventory',
      body_format: 'markdown',
      client_message_id: undefined,
      reply_to_message_id: undefined,
    });
  });

  it('loads a focused thread bootstrap for native deep links', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{
          id: 'message-7',
          conversation_id: 'conversation-1',
          body: 'Целевое сообщение',
          sender: { id: 9, username: 'ivan' },
        }],
        initial_anchor_mode: 'message',
        initial_anchor_message_id: 'message-7',
        has_older: true,
        has_newer: true,
      },
    });

    await expect(getThreadBootstrap('conversation-1', {
      focusMessageId: 'message-7',
      limit: 60,
      lightweight: false,
    })).resolves.toEqual(expect.objectContaining({
      initial_anchor_mode: 'message',
      initial_anchor_message_id: 'message-7',
      has_older: true,
      has_newer: true,
    }));
    expect(mockedClient.get).toHaveBeenCalledWith(
      '/chat/conversations/conversation-1/thread-bootstrap',
      { params: { focus_message_id: 'message-7', limit: 60, lightweight: false } },
    );
  });

  it('does not send an invalid mark-read request without a message id', async () => {
    await markConversationRead('conversation-1');
    expect(mockedClient.post).not.toHaveBeenCalled();
  });

  it('uses the existing web Chat endpoints for native settings and rich sending', async () => {
    mockedClient.patch.mockResolvedValueOnce({ data: {
      id: 'conversation-1',
      kind: 'group',
      title: 'Команда',
      is_muted: true,
    } });
    mockedClient.post
      .mockResolvedValueOnce({ data: {
        id: 'message-task',
        conversation_id: 'conversation-1',
        sender: { id: 1, username: 'me' },
        kind: 'task_share',
        body: '',
      } })
      .mockResolvedValueOnce({ data: {
        id: 'message-sticker',
        conversation_id: 'conversation-1',
        sender: { id: 1, username: 'me' },
        kind: 'file',
        body: '',
      } })
      .mockResolvedValueOnce({ data: { id: 'my-file-1' } });

    await updateConversationSettings('conversation-1', { is_muted: true });
    await shareTask('conversation-1', 'task-7', 'message-1');
    await sendSticker('conversation-1', 'sticker-2');
    await saveAttachmentToMyFiles('message-3', 'attachment-4');

    expect(mockedClient.patch).toHaveBeenCalledWith(
      '/chat/conversations/conversation-1/settings',
      { is_muted: true },
    );
    expect(mockedClient.post).toHaveBeenNthCalledWith(
      1,
      '/chat/conversations/conversation-1/messages/task-share',
      { task_id: 'task-7', reply_to_message_id: 'message-1' },
    );
    expect(mockedClient.post).toHaveBeenNthCalledWith(
      2,
      '/chat/conversations/conversation-1/messages/sticker',
      { sticker_id: 'sticker-2', reply_to_message_id: undefined },
    );
    expect(mockedClient.post).toHaveBeenNthCalledWith(
      3,
      '/chat/messages/message-3/attachments/attachment-4/save-to-my-files',
      {},
    );
  });

  it('loads read receipts, shareable tasks, and installed sticker packs', async () => {
    mockedClient.get
      .mockResolvedValueOnce({ data: { items: [{ user: { id: 2, username: 'maria' }, read_at: '2026-08-23T09:00:00Z' }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'task-1', title: 'Проверить ПК' }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'pack-1', short_name: 'office', title: 'Офис', stickers: [] }] } });

    await expect(getMessageReads('message-1')).resolves.toHaveLength(1);
    await expect(getShareableTasks('conversation-1', 'ПК')).resolves.toEqual([
      expect.objectContaining({ id: 'task-1' }),
    ]);
    await expect(getStickerPacks()).resolves.toEqual([
      expect.objectContaining({ id: 'pack-1' }),
    ]);

    expect(mockedClient.get).toHaveBeenNthCalledWith(1, '/chat/messages/message-1/reads');
    expect(mockedClient.get).toHaveBeenNthCalledWith(
      2,
      '/chat/conversations/conversation-1/shareable-tasks',
      { params: { q: 'ПК' } },
    );
    expect(mockedClient.get).toHaveBeenNthCalledWith(3, '/chat/sticker-packs');
  });

  it('imports a Telegram sticker pack and fetches link previews through the web endpoints', async () => {
    mockedClient.post.mockResolvedValueOnce({ data: { items: [{ id: 'pack-2', short_name: 'cats', title: 'Коты', stickers: [] }] } });
    mockedClient.get.mockResolvedValueOnce({ data: { url: 'https://example.com', title: 'Example' } });

    await expect(importStickerPack(' https://t.me/addstickers/cats ')).resolves.toEqual([
      expect.objectContaining({ id: 'pack-2' }),
    ]);
    await expect(getLinkPreview('https://example.com')).resolves.toEqual({
      url: 'https://example.com',
      title: 'Example',
      description: undefined,
      image: undefined,
      site_name: undefined,
    });

    expect(mockedClient.post).toHaveBeenCalledWith(
      '/chat/sticker-packs/import',
      { source: 'https://t.me/addstickers/cats' },
      { timeout: 120000 },
    );
    expect(mockedClient.get).toHaveBeenCalledWith('/chat/link-preview', { params: { url: 'https://example.com' } });
  });

  it('parses chat folders from the existing web contract', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{ id: 'work', name: 'Работа', unread_count: 4, conversation_ids: ['c1'] }],
        conversation_ids_by_folder: { work: ['c1', 'c2'] },
        folder_unread_counts: { personal: 3, groups: 1, tasks: 0, archived: 2 },
      },
    });

    await expect(listChatFolders()).resolves.toEqual({
      items: [expect.objectContaining({ id: 'work', name: 'Работа', unread_count: 4 })],
      conversation_ids_by_folder: { work: ['c1', 'c2'] },
      folder_unread_counts: { personal: 3, groups: 1, tasks: 0, archived: 2 },
    });
    expect(mockedClient.get).toHaveBeenCalledWith('/chat/folders');
  });

  it('creates, updates and fills folders through the existing web contract', async () => {
    mockedClient.post
      .mockResolvedValueOnce({ data: { item: { id: 'work', name: 'Работа' } } })
      .mockResolvedValueOnce({ data: {} });
    mockedClient.patch.mockResolvedValueOnce({ data: { id: 'work', name: 'Склад', conversation_ids: ['c1'] } });
    mockedClient.delete.mockResolvedValue({ data: {} });

    await expect(createChatFolder('Работа')).resolves.toEqual(expect.objectContaining({
      id: 'work',
      name: 'Работа',
    }));
    await expect(updateChatFolder('work', { name: 'Склад' })).resolves.toEqual(expect.objectContaining({
      id: 'work',
      name: 'Склад',
    }));
    await addFolderConversation('work', 'c1');
    await removeFolderConversation('work', 'c1');
    await deleteChatFolder('work');

    expect(mockedClient.post).toHaveBeenNthCalledWith(1, '/chat/folders', { name: 'Работа' });
    expect(mockedClient.patch).toHaveBeenCalledWith('/chat/folders/work', { name: 'Склад' });
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/chat/folders/work/conversations/c1');
    expect(mockedClient.delete).toHaveBeenNthCalledWith(1, '/chat/folders/work/conversations/c1');
    expect(mockedClient.delete).toHaveBeenNthCalledWith(2, '/chat/folders/work');
  });

  it('loads conversation attachments for the native gallery', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{ id: 'a1', message_id: 'm1', kind: 'image', file_name: 'photo.jpg' }],
        has_more: true,
        next_before_attachment_id: 'a1',
      },
    });

    await expect(getConversationAttachments('conversation-1', { kind: 'image', limit: 24 })).resolves.toEqual({
      items: [expect.objectContaining({ id: 'a1', message_id: 'm1' })],
      has_more: true,
      next_before_attachment_id: 'a1',
    });
    expect(mockedClient.get).toHaveBeenCalledWith(
      '/chat/conversations/conversation-1/attachments',
      { params: { kind: 'image', limit: 24, before_attachment_id: undefined } },
    );
  });

  it('reads system folder unread counts from the folders payload', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [],
        conversation_ids_by_folder: {},
        folder_unread_counts: { personal: 3, groups: 1, tasks: 0, archived: 2 },
      },
    });
    await expect(listChatFolders()).resolves.toEqual(expect.objectContaining({
      folder_unread_counts: { personal: 3, groups: 1, tasks: 0, archived: 2 },
    }));
  });

  it('searches messages across conversations and pins a message on the server', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{
          conversation_id: 'conversation-1',
          conversation_title: 'Склад',
          conversation_kind: 'group',
          message_id: 'message-9',
          preview: 'коробки',
          sender_name: 'Мария',
        }],
      },
    });
    mockedClient.put.mockResolvedValue({
      data: { id: 'conversation-1', kind: 'group', title: 'Склад', pinned_message_id: 'message-9' },
    });

    await expect(searchMessagesGlobal('коробки', 20)).resolves.toEqual([
      expect.objectContaining({
        conversation_id: 'conversation-1',
        message_id: 'message-9',
        preview: 'коробки',
      }),
    ]);
    await expect(setPinnedMessage('conversation-1', 'message-9')).resolves.toEqual(
      expect.objectContaining({ id: 'conversation-1', pinned_message_id: 'message-9' }),
    );
    expect(mockedClient.get).toHaveBeenCalledWith('/chat/messages/search', {
      params: { q: 'коробки', limit: 20 },
    });
    expect(mockedClient.put).toHaveBeenCalledWith(
      '/chat/conversations/conversation-1/pinned-message',
      { message_id: 'message-9' },
    );
  });

  it('renames, resets and deletes AI conversations through scoped endpoints', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{
          id: 'bot-1',
          title: 'OpenCode',
          surface: 'sandbox',
          conversation_ids: ['ai-1'],
        }],
      },
    });
    mockedClient.patch.mockResolvedValue({ data: { id: 'ai-1', kind: 'ai', title: 'Склад' } });
    mockedClient.post.mockResolvedValue({ data: { ok: true } });
    mockedClient.delete.mockResolvedValue({ data: { ok: true } });

    await expect(getAiBots()).resolves.toEqual([
      expect.objectContaining({ id: 'bot-1', name: 'OpenCode', surface: 'sandbox' }),
    ]);
    await expect(renameAiConversation('ai/1', 'Склад')).resolves.toEqual(
      expect.objectContaining({ id: 'ai-1', title: 'Склад' }),
    );
    await resetAiConversationContext('ai/1');
    await deleteAiConversation('ai/1');
    expect(mockedClient.patch).toHaveBeenCalledWith('/chat/ai/conversations/ai%2F1', { title: 'Склад' });
    expect(mockedClient.post).toHaveBeenCalledWith('/chat/ai/conversations/ai%2F1/reset-context');
    expect(mockedClient.delete).toHaveBeenCalledWith('/chat/ai/conversations/ai%2F1');
  });

  it('loads an OpenCode workspace and answers a permission request', async () => {
    mockedClient.get.mockResolvedValue({ data: { enabled: true } });
    mockedClient.post.mockResolvedValue({ data: { ok: true } });
    await getAiSandboxConversation('ai/1');
    await respondAiSandboxPermission('perm/1', 'allow', 'session');
    await attachAiSandboxArchive('ai/1');
    expect(mockedClient.get).toHaveBeenCalledWith('/chat/ai/sandbox/conversations/ai%2F1');
    expect(mockedClient.post).toHaveBeenCalledWith(
      '/chat/ai/sandbox/permissions/perm%2F1/respond',
      { decision: 'allow', scope: 'session' },
    );
    expect(mockedClient.post).toHaveBeenCalledWith('/chat/ai/sandbox/conversations/ai%2F1/archive/attach');
  });

  it('resolves a chat user for the address book', async () => {
    mockedClient.get.mockResolvedValue({
      data: { id: 42, username: 'ivanov', full_name: 'Ivanov Ivan' },
    });
    await expect(resolveChatUser({ email: 'ivanov@zsgp.ru', full_name: 'Ivanov Ivan' })).resolves.toEqual({
      id: 42,
      username: 'ivanov',
      full_name: 'Ivanov Ivan',
    });
    expect(mockedClient.get).toHaveBeenCalledWith('/chat/users/resolve', {
      params: { email: 'ivanov@zsgp.ru', full_name: 'Ivanov Ivan' },
    });
  });

  it('searches the complete user directory with backend query parameters', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{ id: 88, username: 'sidorov', full_name: 'Алексей Сидоров' }],
      },
    });

    await expect(getChatUsers({ query: '  Сидоров  ', limit: 50 })).resolves.toEqual([
      { id: 88, username: 'sidorov', full_name: 'Алексей Сидоров' },
    ]);
    expect(mockedClient.get).toHaveBeenCalledWith('/chat/users', {
      params: { q: 'Сидоров', limit: 50 },
    });
  });
});
