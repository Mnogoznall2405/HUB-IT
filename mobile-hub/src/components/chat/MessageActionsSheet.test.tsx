import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ChatMessage } from '../../api/types';
import { MessageActionsSheet } from './MessageActionsSheet';

const message: ChatMessage = {
  id: 'message-1',
  conversation_id: 'conversation-1',
  sender_user_id: 2,
  body_text: 'Проверь документ',
};

function renderActions(overrides: Partial<React.ComponentProps<typeof MessageActionsSheet>> = {}) {
  return render(
    <MessageActionsSheet
      message={message}
      isOwn={false}
      onClose={jest.fn()}
      onReply={jest.fn()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
      onForward={jest.fn()}
      onReaction={jest.fn()}
      {...overrides}
    />,
  );
}

describe('MessageActionsSheet reactions', () => {
  it('expands from common reactions to the same 16 reactions as web Chat', async () => {
    const view = await renderActions();

    expect(view.getAllByLabelText(/^Добавить реакцию /)).toHaveLength(5);
    const expand = view.getByLabelText('Ещё реакции');
    expect(StyleSheet.flatten(expand.props.style)).toMatchObject({
      minWidth: 44,
      minHeight: 44,
    });

    await fireEvent.press(expand);

    expect(view.getAllByLabelText(/^Добавить реакцию /)).toHaveLength(16);
    expect(view.getByLabelText('Свернуть реакции').props.accessibilityState).toEqual({
      expanded: true,
    });
  });

  it('sends an expanded reaction and closes the menu', async () => {
    const onReaction = jest.fn();
    const onClose = jest.fn();
    const view = await renderActions({ onReaction, onClose });

    await fireEvent.press(view.getByLabelText('Ещё реакции'));
    await fireEvent.press(view.getByLabelText('Добавить реакцию 🎉'));

    expect(onReaction).toHaveBeenCalledWith(message, '🎉');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('MessageActionsSheet pending delivery actions', () => {
  const failedMessage: ChatMessage = { ...message, local_status: 'failed' };

  it('offers retry and delete for a failed message instead of regular actions', async () => {
    const onRetry = jest.fn();
    const onDiscardPending = jest.fn();
    const onClose = jest.fn();
    const view = await renderActions({
      message: failedMessage, onRetry, onDiscardPending, onClose,
    });

    expect(view.queryByLabelText('Переслать')).toBeNull();
    expect(view.queryByLabelText('Копировать текст')).toBeNull();
    expect(view.queryByText('Для этого сообщения действия недоступны')).toBeNull();

    await fireEvent.press(view.getByLabelText('Повторить'));
    expect(onRetry).toHaveBeenCalledWith(failedMessage);
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByLabelText('Удалить'));
    expect(onDiscardPending).toHaveBeenCalledWith(failedMessage);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('offers queue removal for a message still waiting for connection', async () => {
    const onDiscardPending = jest.fn();
    const queuedMessage: ChatMessage = { ...message, local_status: 'failed' };
    const view = await renderActions({ message: queuedMessage, onDiscardPending });

    expect(view.queryByLabelText('Повторить')).toBeNull();
    await fireEvent.press(view.getByLabelText('Убрать из очереди'));
    expect(onDiscardPending).toHaveBeenCalledWith(queuedMessage);
  });

  it('does not offer discard for a message still sending', async () => {
    const onDiscardPending = jest.fn();
    const view = await renderActions({
      message: { ...message, local_status: 'sending' },
      onDiscardPending,
    });
    expect(view.queryByLabelText('Убрать из очереди')).toBeNull();
    expect(view.queryByLabelText('Удалить')).toBeNull();
  });
});

it('keeps all actions in a scrollable menu inside a keyboard-sized viewport', async () => {
  const view = await renderActions({ anchor: { x: 200, y: 650, width: 100, height: 70 } });
  await fireEvent(view.getByTestId('chat-message-actions-viewport'), 'layout', { nativeEvent: { layout: { width: 320, height: 260 } } });
  const style = StyleSheet.flatten(view.getByTestId('chat-message-actions-card').props.style);
  expect(style.maxHeight).toBeLessThanOrEqual(236);
  expect(style.top).toBeGreaterThanOrEqual(12);
  expect(style.top + style.maxHeight).toBeLessThanOrEqual(260);
});
