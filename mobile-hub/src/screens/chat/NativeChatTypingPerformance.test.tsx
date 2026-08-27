import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as chatApi from '../../api/chatApi';
import { NativeChatThreadScreen } from './NativeChatThreadScreen';

const mockChatBubbleRender = jest.fn();
const mockAuthValue = {
  user: { id: 1, username: 'mobile-user', full_name: 'Мобильный пользователь' },
  hasPermission: () => true,
};

jest.mock('../../api/chatApi', () => ({
  getConversation: jest.fn(),
  getMessagesPage: jest.fn(),
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
  const { Text } = require('react-native');
  return {
    SwipeableChatBubble: ({ message }: { message: { id: string; body_text?: string } }) => {
      mockChatBubbleRender(message.id);
      return React.createElement(Text, null, message.body_text);
    },
  };
});

const mockedChatApi = chatApi as jest.Mocked<typeof chatApi>;

it('does not rerender visible message bubbles for each composer keystroke', async () => {
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
      body_text: 'Стабильное сообщение',
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
  mockedChatApi.markConversationRead.mockResolvedValue(undefined);
  const view = await render(<NativeChatThreadScreen conversationId="conversation-1" />);

  await waitFor(() => expect(view.getByText('Стабильное сообщение')).toBeTruthy());
  mockChatBubbleRender.mockClear();
  await fireEvent.changeText(view.getByLabelText('Текст сообщения'), 'О');

  expect(mockChatBubbleRender).not.toHaveBeenCalled();
});
