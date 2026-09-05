import { chatKeyboardAvoidingProps } from './chatKeyboard';

it('uses height on Android adjustResize and padding on iOS', () => {
  expect(chatKeyboardAvoidingProps('android')).toEqual({ behavior: 'height' });
  expect(chatKeyboardAvoidingProps('ios')).toEqual({ behavior: 'padding' });
  expect(chatKeyboardAvoidingProps('android')).not.toHaveProperty('enabled', false);
});
