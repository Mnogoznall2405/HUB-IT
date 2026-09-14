import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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
