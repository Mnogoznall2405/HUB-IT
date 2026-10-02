import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as chatApi from '../../api/chatApi';
import type { ChatConversationSummary, ChatMessage, ChatThreadBootstrapPage } from '../../api/types';
import { chatSocket } from '../../chat/chatSocket';
import { getPinnedChatMessageId } from '../../chat/chatPinnedMessages';
import { NativeChatThreadWithDelivery as NativeChatThreadScreen } from '../../test/NativeChatWithDelivery';

const mockSocketHandlers = new Map<string, Set<(payload: unknown) => void>>();
const emitSocket = (event: string, payload: unknown) => {
  mockSocketHandlers.get(event)?.forEach((handler) => handler(payload));
};

const mockAuthValue = {
  user: { id: 1, username: 'mobile-user', full_name: 'Мобильный пользователь' },
  hasPermission: () => true,
};

jest.mock('../../api/chatApi', () => ({
  getConversation: jest.fn(),
  getMessagesPage: jest.fn(),
  getThreadBootstrap: jest.fn(),
  getConversationAttachments: jest.fn(),
  getAiConversationAccess: jest.fn(async () => ({ can_use: true })),
  markConversationRead: jest.fn(),
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuthValue,
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
    subscribeConversation: jest.fn(),
    unsubscribeConversation: jest.fn(),
    sendTyping: jest.fn(),
    watchPresence: jest.fn(),
  },
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeSnapshot: jest.fn(async () => true),
  readNativeEntitySnapshot: jest.fn(async () => null),
  writeNativeEntitySnapshot: jest.fn(async () => undefined),
}));

jest.mock('../../chat/chatPinnedMessages', () => ({
  getPinnedChatMessageId: jest.fn(async () => null),
  setPinnedChatMessageId: jest.fn(async () => undefined),
}));

// Structural stub: exposes the bubble callbacks the thread wires up so tests
// can drive the same event paths (tap/long-press/attachment/album/reply).
jest.mock('../../components/chat/SwipeableChatBubble', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SwipeableChatBubble: (props: {
      message: ChatMessage;
      isOwn?: boolean;
      showSenderAvatars?: boolean;
      album?: { entries: Array<{ message: ChatMessage; attachment: { id: string } }> };
      onPress?: () => void;
      onLongPress?: () => void;
      onAttachmentPress?: (attachment: unknown) => void;
      onAttachmentOpen?: (attachment: unknown) => void;
      onAlbumAttachmentPress?: (entry: unknown) => void;
      onReplyPreviewPress?: (targetId: string) => void;
    }) => {
      const message = props.message;
      return React.createElement(View, null,
        React.createElement(Pressable, {
          testID: `bubble-${message.id}`,
          onPress: props.onPress,
          onLongPress: props.onLongPress,
        },
          props.showSenderAvatars && !props.isOwn && message.sender
            ? React.createElement(
              Text,
              { testID: `sender-${message.id}` },
              `sender:${message.sender.full_name || message.sender.username}`,
            )
            : null,
          React.createElement(Text, null, message.body_text)),
        (message.attachments || []).map((attachment) => React.createElement(Pressable, {
          key: attachment.id,
          testID: `attach-${attachment.id}`,
          onPress: () => props.onAttachmentPress?.(attachment),
        })),
        (message.attachments || []).map((attachment) => React.createElement(Pressable, {
          key: `${attachment.id}-open`,
          testID: `attach-open-${attachment.id}`,
          onPress: () => props.onAttachmentOpen?.(attachment),
        })),
        (props.album?.entries || []).map((entry) => React.createElement(Pressable, {
          key: `album-${entry.attachment.id}`,
          testID: `album-${entry.attachment.id}`,
          onPress: () => props.onAlbumAttachmentPress?.(entry),
        })),
        message.reply_preview?.id
          ? React.createElement(Pressable, {
            testID: `reply-preview-${message.id}`,
            onPress: () => props.onReplyPreviewPress?.(message.reply_preview!.id),
          })
          : null);
    },
  };
});

jest.mock('../../components/chat/ChatMediaViewer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ChatMediaViewer: ({ item }: { item: unknown }) => (
      item ? React.createElement(View, { testID: 'media-viewer-open' }) : null
    ),
  };
});

jest.mock('../../components/chat/ChatAttachmentActionsSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ChatAttachmentActionsSheet: ({ attachment }: { attachment: unknown }) => (
      attachment ? React.createElement(View, { testID: 'attachment-actions-open' }) : null
    ),
  };
});

const mockedChatApi = chatApi as jest.Mocked<typeof chatApi>;
const watchPresence = jest.mocked(chatSocket.watchPresence);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const textMessage = (id: string, body: string, createdAt: string, sender = 2): ChatMessage => ({
  id,
  conversation_id: 'conversation-1',
  sender_user_id: sender,
  sender: { id: sender, username: `user-${sender}`, full_name: `Участник ${sender}` },
  body_text: body,
  created_at: createdAt,
});

const imageAttachment = (id: string) => ({
  id,
  kind: 'image' as const,
  media_kind: 'image' as const,
  mime_type: 'image/jpeg',
  file_name: `${id}.jpg`,
  url: `https://cdn.example/${id}.jpg`,
  preview_url: `https://cdn.example/${id}-preview.jpg`,
});

const livePage = (items: ChatMessage[], overrides: Partial<ChatThreadBootstrapPage> = {}): ChatThreadBootstrapPage => ({
  items,
  has_more: false,
  has_older: false,
  has_newer: false,
  cursor_invalid: false,
  older_cursor_message_id: null,
  newer_cursor_message_id: null,
  viewer_last_read_message_id: null,
  viewer_last_read_at: null,
  initial_anchor_mode: 'bottom',
  initial_anchor_message_id: null,
  ...overrides,
});

const directConversation: ChatConversationSummary = {
  id: 'conversation-1',
  kind: 'direct',
  title: 'Мария Иванова',
};

beforeEach(() => {
  mockSocketHandlers.clear();
  mockedChatApi.getConversation.mockResolvedValue(directConversation);
  mockedChatApi.getConversationAttachments.mockResolvedValue({
    items: [],
    has_more: false,
    next_before_attachment_id: null,
  });
  mockedChatApi.markConversationRead.mockResolvedValue(true);
});

// T1: in selection mode a tap on a photo/video/document must toggle selection
// instead of opening the media viewer or the attachment actions sheet.
it('toggles selection on attachment taps while selecting instead of opening the viewer', async () => {
  const messages = [
    { ...textMessage('m-photo', 'Фото отчёта', '2026-08-23T08:02:00Z'), attachments: [imageAttachment('att-photo')] },
    textMessage('m-text', 'Простое сообщение', '2026-08-23T08:01:00Z'),
    {
      ...textMessage('m-doc', 'Документ', '2026-08-23T08:00:00Z'),
      attachments: [{
        id: 'att-doc', kind: 'file' as const, media_kind: 'file' as const,
        mime_type: 'application/pdf', file_name: 'report.pdf',
      }],
    },
  ];
  mockedChatApi.getThreadBootstrap.mockResolvedValue(livePage(messages));

  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
  await waitFor(() => expect(view.getByTestId('bubble-m-text')).toBeTruthy());

  await act(async () => {
    fireEvent(view.getByTestId('bubble-m-text'), 'longPress');
  });
  await waitFor(() => expect(view.getByLabelText('Готово')).toBeTruthy());
  expect(view.getByText('1')).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByTestId('attach-att-photo'));
  });
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  expect(view.queryByTestId('media-viewer-open')).toBeNull();
  expect(view.queryByTestId('attachment-actions-open')).toBeNull();

  await act(async () => {
    fireEvent.press(view.getByTestId('attach-open-att-doc'));
  });
  await waitFor(() => expect(view.getByText('3')).toBeTruthy());
  expect(view.queryByTestId('media-viewer-open')).toBeNull();
  expect(view.queryByTestId('attachment-actions-open')).toBeNull();
});

it('still opens the media viewer on a photo tap outside selection', async () => {
  mockedChatApi.getThreadBootstrap.mockResolvedValue(livePage([
    { ...textMessage('m-photo', 'Фото отчёта', '2026-08-23T08:02:00Z'), attachments: [imageAttachment('att-photo')] },
  ]));

  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
  await waitFor(() => expect(view.getByTestId('attach-att-photo')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId('attach-att-photo'));
  });
  await waitFor(() => expect(view.getByTestId('media-viewer-open')).toBeTruthy());
});

// T2: messages render before the group conversation arrives; sender names
// must appear without any extra user action once it resolves.
it('shows sender names when the group conversation resolves after its messages', async () => {
  const conversationGate = deferred<ChatConversationSummary>();
  mockedChatApi.getConversation.mockImplementation(() => conversationGate.promise);
  mockedChatApi.getThreadBootstrap.mockResolvedValue(livePage([
    textMessage('m-grp', 'Групповое приветствие', '2026-08-23T08:00:00Z'),
  ]));

  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
  await waitFor(() => expect(view.getByText('Групповое приветствие')).toBeTruthy());
  expect(view.queryByTestId('sender-m-grp')).toBeNull();

  await act(async () => {
    conversationGate.resolve({
      id: 'conversation-1',
      kind: 'group',
      title: 'Группа проекта',
      member_count: 3,
      members: [
        { user: { id: 2, username: 'user-2', full_name: 'Участник 2' }, member_role: 'member' },
      ],
    });
  });
  await waitFor(() => expect(view.getByTestId('sender-m-grp')).toBeTruthy());
});

// T3: each chat.presence.updated frame rebuilds conversation.members; the
// watch subscription must not churn watchPresence calls per frame.
it('does not resubscribe presence watches on each presence frame', async () => {
  mockedChatApi.getConversation.mockResolvedValue({
    id: 'conversation-1',
    kind: 'group',
    title: 'Группа проекта',
    member_count: 3,
    members: [
      { user: { id: 2, username: 'user-2', full_name: 'Участник 2' }, member_role: 'member' },
      { user: { id: 3, username: 'user-3', full_name: 'Участник 3' }, member_role: 'member' },
    ],
  });
  mockedChatApi.getThreadBootstrap.mockResolvedValue(livePage([
    textMessage('m-1', 'Первое сообщение', '2026-08-23T08:00:00Z'),
  ]));

  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
  await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
  await waitFor(() => expect(watchPresence).toHaveBeenCalledWith([2, 3]));

  watchPresence.mockClear();
  await act(async () => {
    emitSocket('chat.presence.updated', {
      payload: { user_id: 2, presence: { status: 'online', is_online: true } },
    });
  });
  await act(async () => {
    emitSocket('chat.presence.updated', {
      payload: { user_id: 3, presence: { status: 'offline', is_online: false } },
    });
  });
  await act(async () => { await Promise.resolve(); });
  expect(watchPresence).not.toHaveBeenCalled();
});

// T5: selection ids must be pruned when the window is replaced by a jump or
// when a selected message is deleted remotely.
it('drops remote-deleted messages from the selection count', async () => {
  const messages = [
    textMessage('m-1', 'Первое сообщение', '2026-08-23T08:02:00Z'),
    textMessage('m-2', 'Второе сообщение', '2026-08-23T08:01:00Z'),
    textMessage('m-3', 'Третье сообщение', '2026-08-23T08:00:00Z'),
  ];
  mockedChatApi.getThreadBootstrap.mockResolvedValue(livePage(messages));

  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
  await waitFor(() => expect(view.getByTestId('bubble-m-1')).toBeTruthy());

  await act(async () => {
    fireEvent(view.getByTestId('bubble-m-1'), 'longPress');
  });
  await act(async () => {
    fireEvent.press(view.getByTestId('bubble-m-2'));
  });
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());

  await act(async () => {
    emitSocket('chat.message.deleted', {
      payload: {
        message: {
          ...messages[1],
          body_text: 'Сообщение удалено',
          is_deleted: true,
        },
      },
    });
  });
  await waitFor(() => expect(view.getByText('1')).toBeTruthy());
  expect(view.queryByText('2')).toBeNull();
});

it('hides the selection header after a window jump leaves the selected messages', async () => {
  const jumpTarget: ChatMessage = {
    ...textMessage('m-old-target', 'Старое сообщение', '2026-08-20T08:00:00Z'),
  };
  const messages = [
    {
      ...textMessage('m-1', 'С ответом', '2026-08-23T08:02:00Z'),
      reply_preview: { id: 'm-old-target', sender_name: 'Участник 2', body: 'Старое сообщение' },
    },
    textMessage('m-2', 'Второе сообщение', '2026-08-23T08:01:00Z'),
  ];
  mockedChatApi.getThreadBootstrap.mockImplementation(async (_id, options) => {
    if (options?.focusMessageId) {
      return livePage([jumpTarget], {
        has_older: true,
        has_newer: true,
        older_cursor_message_id: 'm-old-target',
        newer_cursor_message_id: 'm-old-target',
        initial_anchor_mode: 'message',
        initial_anchor_message_id: 'm-old-target',
      });
    }
    return livePage(messages);
  });

  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
  await waitFor(() => expect(view.getByTestId('bubble-m-1')).toBeTruthy());

  await act(async () => {
    fireEvent(view.getByTestId('bubble-m-1'), 'longPress');
  });
  await act(async () => {
    fireEvent.press(view.getByTestId('bubble-m-2'));
  });
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId('reply-preview-m-1'));
  });
  await waitFor(() => expect(view.getByText('Старое сообщение')).toBeTruthy());
  expect(view.queryByLabelText('Готово')).toBeNull();
});

// T10: an in-place conversationId switch must clear per-thread UI state —
// selection, the unread boundary, jump-to-bottom counters and pinned bar.
it('resets thread-scoped state when conversationId changes in place', async () => {
  const firstMessages = [
    textMessage('m-1', 'Первое сообщение', '2026-08-23T08:02:00Z'),
    textMessage('m-2', 'Второе сообщение', '2026-08-23T08:01:00Z'),
  ];
  mockedChatApi.getThreadBootstrap.mockImplementation(async (id, options) => {
    if (options?.focusMessageId) return livePage([]);
    if (id === 'conversation-2') {
      return livePage([
        { ...textMessage('c2-m1', 'Другой диалог', '2026-08-24T08:00:00Z'), conversation_id: 'conversation-2' },
      ]);
    }
    return livePage(firstMessages, {
      has_newer: true,
      newer_cursor_message_id: 'm-1',
      pinned_message_id: 'm-2',
    });
  });
  mockedChatApi.getConversation.mockImplementation(async (id) => (
    id === 'conversation-2'
      ? { id: 'conversation-2', kind: 'direct', title: 'Второй диалог' }
      : directConversation
  ));

  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);
  await waitFor(() => expect(view.getByText('Первое сообщение')).toBeTruthy());
  await waitFor(() => expect(view.getByLabelText('Перейти к последним сообщениям')).toBeTruthy());
  await waitFor(() => expect(view.getByText('Закреплённое сообщение')).toBeTruthy());

  await act(async () => {
    fireEvent(view.getByTestId('bubble-m-1'), 'longPress');
  });
  await waitFor(() => expect(view.getByLabelText('Готово')).toBeTruthy());

  await act(async () => {
    view.rerender(<NativeChatThreadScreen conversationId="conversation-2" />);
  });
  await waitFor(() => expect(view.getByText('Другой диалог')).toBeTruthy());

  expect(view.queryByLabelText('Готово')).toBeNull();
  expect(view.queryByLabelText('Перейти к последним сообщениям')).toBeNull();
  expect(view.queryByText('Закреплённое сообщение')).toBeNull();
  expect(view.queryByText('Первое сообщение')).toBeNull();
  expect(getPinnedChatMessageId).toHaveBeenCalledWith(1, 'conversation-2');
});
