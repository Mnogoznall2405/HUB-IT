import { render } from '@testing-library/react-native';
import { ChatBubble } from './ChatBubble';

describe('ChatBubble pending delivery', () => {
  it('shows a compact spinner without an extra sending text label', async () => {
    const view = await render(
      <ChatBubble
        isOwn
        message={{
          id: 'pending:message-1',
          conversation_id: 'conversation-1',
          sender_user_id: 1,
          body_text: 'Проверка',
          created_at: '2026-08-27T10:00:00Z',
          is_own: true,
          local_status: 'sending',
        }}
      />,
    );

    expect(view.getByTestId('chat-message-sending-spinner')).toBeTruthy();
    expect(view.getByLabelText('Сообщение отправляется')).toBeTruthy();
    expect(view.queryByText(/Отправляется/)).toBeNull();
  });
});
