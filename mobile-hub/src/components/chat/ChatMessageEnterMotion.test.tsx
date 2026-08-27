import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  CHAT_MESSAGE_ENTER_DURATION_MS,
  ChatMessageEnterMotion,
  chatMessageMotionKey,
} from './ChatMessageEnterMotion';

describe('chat message enter motion', () => {
  it('keeps the same render key when an optimistic message is reconciled by client id', () => {
    expect(chatMessageMotionKey({ id: 'pending:mobile-1', client_message_id: 'mobile-1', sender_user_id: 7 }))
      .toBe(chatMessageMotionKey({ id: 'server-42', client_message_id: 'mobile-1', sender_user_id: 7 }));
    expect(CHAT_MESSAGE_ENTER_DURATION_MS).toBe(250);
  });

  it('falls back to the authoritative message id for incoming messages', () => {
    expect(chatMessageMotionKey({ id: 'server-43', client_message_id: null, sender_user_id: 8 }))
      .toBe('message:server-43');
  });

  it('skips movement when reduced motion is enabled', async () => {
    const onFinished = jest.fn();
    const view = await render(
      <ChatMessageEnterMotion
        motionKey="message:server-43"
        kind="incoming"
        reduceMotion
        onFinished={onFinished}
      >
        <Text>Новое сообщение</Text>
      </ChatMessageEnterMotion>,
    );

    expect(view.getByText('Новое сообщение')).toBeTruthy();
    expect(onFinished).toHaveBeenCalledWith('message:server-43');
  });
});
