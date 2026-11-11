import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import { ChatConversationRow } from './ChatConversationRow';

it('offers a visible 44dp conversation menu without opening the conversation', async () => {
  const onPress = jest.fn();
  const onActions = jest.fn();
  const view = await render(<ChatConversationRow item={{ id: 'c1', kind: 'direct', title: 'Мария' }}
    onPress={onPress} onLongPress={onActions} />);
  const button = view.getByLabelText('Действия диалога Мария');
  const stopPropagation = jest.fn();
  await fireEvent.press(button, { stopPropagation });
  expect(onActions).toHaveBeenCalledTimes(1);
  expect(onPress).not.toHaveBeenCalled();
  expect(stopPropagation).toHaveBeenCalled();
  expect(StyleSheet.flatten(button.props.style)).toEqual(expect.objectContaining({ width: 44, height: 44 }));
});

it('shows the mention mark only while the conversation still has unread messages', async () => {
  const unreadWithMention = {
    id: 'c2', kind: 'direct', title: 'Команда', unread_count: 3, unread_mention_count: 1,
  } as ChatConversationSummary;
  const view = await render(<ChatConversationRow item={unreadWithMention} onPress={jest.fn()} />);
  expect(view.getByTestId('chat-row-mention')).toBeTruthy();
  expect(view.getByLabelText(/Упоминаний: 1/)).toBeTruthy();

  // A local read clears unread_count before the mention counter catches up.
  await view.rerender(<ChatConversationRow item={{ ...unreadWithMention, unread_count: 0 }} onPress={jest.fn()} />);
  expect(view.queryByTestId('chat-row-mention')).toBeNull();
});
