import { chatKeyboardAvoidingProps } from './chatKeyboard';

it('keeps Android and iOS on the same padding behavior without an enabled-gate', () => {
  expect(chatKeyboardAvoidingProps()).toEqual({ behavior: 'padding' });
  expect(chatKeyboardAvoidingProps()).not.toHaveProperty('enabled', false);
});
