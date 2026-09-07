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

it('keeps all actions in a scrollable menu inside a keyboard-sized viewport', async () => {
  const view = await renderActions({ anchor: { x: 200, y: 650, width: 100, height: 70 } });
  await fireEvent(view.getByTestId('chat-message-actions-viewport'), 'layout', { nativeEvent: { layout: { width: 320, height: 260 } } });
  const style = StyleSheet.flatten(view.getByTestId('chat-message-actions-card').props.style);
  expect(style.maxHeight).toBeLessThanOrEqual(236);
  expect(style.top).toBeGreaterThanOrEqual(12);
  expect(style.top + style.maxHeight).toBeLessThanOrEqual(260);
});
