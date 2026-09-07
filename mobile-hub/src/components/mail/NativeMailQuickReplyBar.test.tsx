import { fireEvent, render } from '@testing-library/react-native';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeMailQuickReplyBar } from './NativeMailQuickReplyBar';
import { Alert } from 'react-native';

it('keeps an uncertain reply locked until the user explicitly resolves it', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const onResolve = jest.fn();
  const onExpand = jest.fn();
  const onReview = jest.fn();
  const onSend = jest.fn();
  const view = await render(<NativeMailQuickReplyBar testID="bar" inputTestID="input" sendTestID="send" value="Ответ" busy={false} disabled={false} pending placeholder="Ответ" tokens={getFluentTokens('dark')} onChangeText={jest.fn()} onExpand={onExpand} onSend={onSend} onReview={onReview} onResolve={onResolve} />);
  expect(view.getByTestId('input').props.editable).toBe(false);
  await fireEvent.press(view.getByText('Полный редактор'));
  expect(onExpand).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Проверить отправленные'));
  expect(onReview).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByText('Завершить проверку'));
  expect(onResolve).not.toHaveBeenCalled();
  alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Да, ответ отправлен')?.onPress?.();
  expect(onResolve).toHaveBeenCalledWith(true);
  await fireEvent.press(view.getByTestId('send'));
  expect(onSend).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

it('keeps reply actions available and blocks them during sending', async () => {
  const onSend = jest.fn();
  const onExpand = jest.fn();
  const onChangeText = jest.fn();
  const props = { testID: 'bar', inputTestID: 'input', sendTestID: 'send', value: 'Ответ', busy: false, disabled: false, placeholder: 'Ответить', tokens: getFluentTokens('light'), onSend, onExpand, onChangeText };
  const view = await render(<NativeMailQuickReplyBar {...props} />);
  await fireEvent.changeText(view.getByTestId('input'), 'Новый ответ');
  expect(onChangeText).toHaveBeenCalledWith('Новый ответ');
  await fireEvent.press(view.getByText('Полный редактор'));
  await fireEvent.press(view.getByTestId('send'));
  expect(onExpand).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledTimes(1);
  await view.rerender(<NativeMailQuickReplyBar {...props} busy error="Сеть недоступна" />);
  expect(view.getByTestId('input').props.editable).toBe(false);
  expect(view.getByRole('alert').props.children).toBe('Сеть недоступна');
  await fireEvent.press(view.getByText('Полный редактор'));
  await fireEvent.press(view.getByTestId('send'));
  expect(onExpand).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledTimes(1);
});
