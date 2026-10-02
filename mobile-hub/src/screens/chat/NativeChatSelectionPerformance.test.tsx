import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as chatApi from '../../api/chatApi';
import { NativeChatThreadWithDelivery as NativeChatThreadScreen } from '../../test/NativeChatWithDelivery';

const mockChatBubbleRender = jest.fn();
const mockAuthValue = {
  user: { id: 1, username: 'mobile-user', full_name: 'Мобильный пользователь' },
  hasPermission: () => true,
};

jest.mock('../../api/chatApi', () => ({
  getConversation: jest.fn(),
  getMessagesPage: jest.fn(),
  getThreadBootstrap: jest.fn(),
  markConversationRead: jest.fn(),
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../chat/chatSocket', () => ({
  shouldUseChatHttpFallback: (status: string) => ['offline', 'error', 'reconnecting'].includes(status),
  chatSocket: {
    getStatus: () => 'connected',
    on: jest.fn(() => jest.fn()),
    connect: jest.fn(async () => undefined),
    subscribeConversation: jest.fn(),
    unsubscribeConversation: jest.fn(),
    sendTyping: jest.fn(),
    watchPresence: jest.fn(),
  },
}));

jest.mock('../../components/chat/SwipeableChatBubble', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    SwipeableChatBubble: ({ message, onPress, onLongPress }: {
      message: { id: string; body_text?: string };
      onPress?: () => void;
      onLongPress?: () => void;
    }) => {
      mockChatBubbleRender(message.id);
      return React.createElement(Pressable, { onPress, onLongPress },
        React.createElement(Text, null, message.body_text));
    },
  };
});

const mockedChatApi = chatApi as jest.Mocked<typeof chatApi>;

const MESSAGES = Array.from({ length: 6 }, (_, index) => ({
  id: `message-${index + 1}`,
  conversation_id: 'conversation-1',
  sender_user_id: 2,
  body_text: `Сообщение ${index + 1}`,
  created_at: `2026-08-23T08:0${index}:00Z`,
}));

beforeEach(() => {
  // M7: history starts from getThreadBootstrap; reject it so tests exercise
  // the getMessagesPage fallback path.
  mockedChatApi.getThreadBootstrap.mockRejectedValue(new Error('404'));
  mockedChatApi.getConversation.mockResolvedValue({
    id: 'conversation-1',
    kind: 'direct',
    title: 'Мария Иванова',
  });
  mockedChatApi.getMessagesPage.mockResolvedValue({
    items: MESSAGES,
    has_more: false,
    has_older: false,
    has_newer: false,
    cursor_invalid: false,
    older_cursor_message_id: null,
    newer_cursor_message_id: null,
    viewer_last_read_message_id: null,
    viewer_last_read_at: null,
  });
  mockedChatApi.markConversationRead.mockResolvedValue(true);
});

it('rerenders at most two rows when the selection set changes by one message', async () => {
  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

  await waitFor(() => expect(view.getByText('Сообщение 6')).toBeTruthy());
  mockChatBubbleRender.mockClear();

  // Enter selection mode: header may change, but only the picked row rerenders.
  await fireEvent(view.getByText('Сообщение 3'), 'longPress');
  await waitFor(() => expect(view.getByLabelText('Готово')).toBeTruthy());
  expect(mockChatBubbleRender.mock.calls.length).toBeLessThanOrEqual(2);

  // Toggling another message inside the mode rerenders only that row.
  mockChatBubbleRender.mockClear();
  await fireEvent.press(view.getByText('Сообщение 2'));
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  expect(mockChatBubbleRender.mock.calls.length).toBeLessThanOrEqual(2);

  // Deselecting one message rerenders only that row.
  mockChatBubbleRender.mockClear();
  await fireEvent.press(view.getByText('Сообщение 3'));
  await waitFor(() => expect(view.getByText('1')).toBeTruthy());
  expect(mockChatBubbleRender.mock.calls.length).toBeLessThanOrEqual(2);

  // Leaving selection mode touches only the still-selected row, not the list.
  mockChatBubbleRender.mockClear();
  await fireEvent.press(view.getByLabelText('Готово'));
  await waitFor(() => expect(view.queryByLabelText('Готово')).toBeNull());
  expect(mockChatBubbleRender.mock.calls.length).toBeLessThanOrEqual(2);
});
