import { Platform } from 'react-native';

/**
 * Chat keyboard avoidance, one switch for comparing on a device.
 *  - 'follow' (default, parity plan T1): react-native-keyboard-controller
 *    KeyboardAvoidingView, which moves with the keyboard frame on the UI thread.
 *  - 'legacy': React Native's KeyboardAvoidingView with the shared
 *    chatKeyboardAvoidingProps (JS-thread height/padding), the path the chat
 *    inbox used before T1.
 * Flip the constant and rebuild the APK to compare; keyboard_show/keyboard_hide
 * device-log entries carry the active mode.
 */
export type ChatKeyboardMode = 'legacy' | 'follow';
export const CHAT_KEYBOARD_MODE: ChatKeyboardMode = 'follow';

export function chatKeyboardAvoidingImplementation(
  mode: ChatKeyboardMode = CHAT_KEYBOARD_MODE,
): 'controller' | 'native' {
  return mode === 'legacy' ? 'native' : 'controller';
}

export function chatKeyboardAvoidingProps(platform: string = Platform.OS) {
  return {
    behavior: platform === 'ios' ? ('padding' as const) : ('height' as const),
  };
}
