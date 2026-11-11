import { chatKeyboardAvoidingImplementation, chatKeyboardAvoidingProps } from './chatKeyboard';

it('uses height on Android adjustResize and padding on iOS', () => {
  expect(chatKeyboardAvoidingProps('android')).toEqual({ behavior: 'height' });
  expect(chatKeyboardAvoidingProps('ios')).toEqual({ behavior: 'padding' });
  expect(chatKeyboardAvoidingProps('android')).not.toHaveProperty('enabled', false);
});

// The mode switch decides which KeyboardAvoidingView the chat renders: 'legacy'
// keeps React Native's, 'follow' uses react-native-keyboard-controller.
it('maps the keyboard mode to the avoidance implementation', () => {
  expect(chatKeyboardAvoidingImplementation('legacy')).toBe('native');
  expect(chatKeyboardAvoidingImplementation('follow')).toBe('controller');
});
