import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { ChatMessage, ChatConversationSummary } from '../../api/types';
import { ForwardMessageSheet } from './ForwardMessageSheet';

const message = { id: 'synthetic', body_text: 'Текст' } as ChatMessage;
const conversations = [{ id: 'one', title: 'Анна' }, { id: 'two', title: 'Борис' }] as ChatConversationSummary[];

it('clears the previous search after closing, without clearing a visible retry', async () => {
  const props = { message, conversations, busy: false, onClose: jest.fn(), onForward: jest.fn() };
  const view = await render(<ForwardMessageSheet {...props} />);
  await fireEvent.changeText(view.getByLabelText('Поиск диалога для пересылки'), 'Анна');
  expect(view.queryByLabelText('Переслать в Борис')).toBeNull();
  await view.rerender(<ForwardMessageSheet {...props} error="Повторите" />);
  expect(view.getByLabelText('Поиск диалога для пересылки').props.value).toBe('Анна');
  await view.rerender(<ForwardMessageSheet {...props} message={null} />);
  await view.rerender(<ForwardMessageSheet {...props} />);
  expect(view.getByLabelText('Переслать в Борис')).toBeTruthy();
  expect(view.getByLabelText('Поиск диалога для пересылки').props.value).toBe('');
});

it('uses current bottom and landscape cutout insets', async () => {
  const wrap = (bottom: number, left: number) => <SafeAreaInsetsContext.Provider value={{ bottom, left, right: 0, top: 0 }}>
    <ForwardMessageSheet message={message} count={2} conversations={conversations} busy={false} onClose={jest.fn()} onForward={jest.fn()} />
  </SafeAreaInsetsContext.Provider>;
  const view = await render(wrap(34, 0));
  expect(view.getByText('Переслать 2 сообщения')).toBeTruthy();
  expect(StyleSheet.flatten(view.getByTestId('chat-forward-sheet').props.style).paddingBottom).toBe(34);
  await view.rerender(wrap(0, 44));
  expect(StyleSheet.flatten(view.getByTestId('chat-forward-sheet').props.style)).toMatchObject({ paddingBottom: 20, paddingLeft: 56 });
});
