import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ChatConfirmHost, confirmChatAction } from './ChatConfirmDialog';

const options = {
  title: 'Удалить сообщение?',
  message: 'Текст и вложения будут скрыты.',
  confirmText: 'Удалить',
  destructive: true,
};

it('resolves true when the in-app confirm is accepted', async () => {
  const view = await render(<ChatConfirmHost />);
  let answer: Promise<boolean> | undefined;
  await act(async () => {
    answer = confirmChatAction(options);
  });
  await fireEvent.press(view.getByLabelText('Удалить'));
  await expect(answer).resolves.toBe(true);
});

it('resolves false on cancel and when the dialog is dismissed', async () => {
  const view = await render(<ChatConfirmHost />);
  let answer: Promise<boolean> | undefined;
  await act(async () => {
    answer = confirmChatAction(options);
  });
  await fireEvent.press(view.getByLabelText('Отмена'));
  await expect(answer).resolves.toBe(false);
});

it('falls back to the native alert when no host is mounted', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const answer = confirmChatAction(options);
  const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
  buttons.find((button) => button.text === 'Удалить')?.onPress?.();
  await expect(answer).resolves.toBe(true);
  alert.mockRestore();
});
