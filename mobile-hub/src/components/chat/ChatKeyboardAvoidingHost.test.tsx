import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

it('lifts modal content with the shared padding behavior', async () => {
  const view = await render(
    <ChatKeyboardAvoidingHost>
      <Text>Поиск</Text>
    </ChatKeyboardAvoidingHost>,
  );

  expect(view.getByText('Поиск')).toBeTruthy();
  expect(view.getByTestId('chat-keyboard-avoiding')).toBeTruthy();
});
