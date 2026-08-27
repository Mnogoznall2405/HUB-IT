export const CHAT_KEYBOARD_AVOIDING_BEHAVIOR = 'padding' as const;

export function chatKeyboardAvoidingProps() {
  return {
    behavior: CHAT_KEYBOARD_AVOIDING_BEHAVIOR,
  };
}
