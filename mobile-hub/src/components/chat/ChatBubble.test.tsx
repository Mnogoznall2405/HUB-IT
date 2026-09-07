import { StyleSheet } from 'react-native';
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

it('reserves the same delivery slot for sending, sent, read and failed', async () => {
  const message = { id: 'm1', conversation_id: 'c1', sender_user_id: 1, body_text: 'same text', created_at: '2026-09-05T10:00:00Z' };
  const view = await render(<ChatBubble isOwn message={{ ...message, local_status: 'sending' }} />);
  const initial = StyleSheet.flatten(view.getByTestId('chat-delivery-status').props.style);
  for (const state of [{ delivery_status: 'sent' as const }, { delivery_status: 'read' as const }, { local_status: 'failed' as const }]) {
    await view.rerender(<ChatBubble isOwn message={{ ...message, ...state }} />);
    expect(StyleSheet.flatten(view.getByTestId('chat-delivery-status').props.style)).toEqual(initial);
  }
});
