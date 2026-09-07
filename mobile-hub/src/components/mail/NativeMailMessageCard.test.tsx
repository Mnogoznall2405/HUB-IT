import { fireEvent, render } from '@testing-library/react-native';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeMailMessageCard } from './NativeMailMessageCard';

it('reveals the full sender address in reader details', async () => {
  const view = await render(<NativeMailMessageCard reader tokens={getFluentTokens('dark')} message={{ id: 'details', sender_display: 'Отправитель', sender_email: 'sender@example.invalid', body_text: 'Текст', to: ['recipient@example.invalid'] }} />);
  expect(view.queryByText('sender@example.invalid')).toBeNull();
  await fireEvent.press(view.getByTestId('native-mail-recipient-details'));
  expect(view.getByText('sender@example.invalid')).toBeTruthy();
  expect(view.getByText('recipient@example.invalid')).toBeTruthy();
  await fireEvent.press(view.getByTestId('native-mail-recipient-details'));
  expect(view.queryByText('sender@example.invalid')).toBeNull();
});

it('keeps external image permission for the current message only', async () => {
  const message = {
    id: 'synthetic-message', mailbox_id: 'box-a', subject: 'Проверка',
    body_html: '<p>Письмо</p><img src="https://example.invalid/synthetic.png">',
    attachments: [],
  };
  const tokens = getFluentTokens('light');
  const view = await render(<NativeMailMessageCard message={message} tokens={tokens} />);
  await fireEvent.press(view.getByTestId('native-mail-toggle-external-images'));
  expect(view.getByText('Внешние изображения разрешены для этого письма.')).toBeTruthy();
  await view.rerender(<NativeMailMessageCard message={{ ...message, subject: 'Обновлённая тема' }} tokens={tokens} />);
  expect(view.getByText('Внешние изображения разрешены для этого письма.')).toBeTruthy();
  await view.rerender(<NativeMailMessageCard message={{ ...message, mailbox_id: 'box-b' }} tokens={tokens} />);
  expect(view.getByText('Внешние изображения скрыты для защиты приватности.')).toBeTruthy();
});
