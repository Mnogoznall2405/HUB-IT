import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView as NativeKeyboardAvoidingView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  chatKeyboardAvoidingImplementation,
  chatKeyboardAvoidingProps,
} from '../../chat/chatKeyboard';
import { useChatKeyboardDeviceLog } from '../../chat/chatDeviceEvents';
import { useChatKeyboardMotion } from '../../chat/useChatKeyboardMotion';

/**
 * Keyboard avoidance for chat surfaces. The implementation follows
 * CHAT_KEYBOARD_MODE (follow = keyboard-controller, legacy = React Native), so
 * every chat KeyboardAvoidingView switches together.
 */
export function ChatKeyboardAvoiding({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  useChatKeyboardDeviceLog();
  const props = chatKeyboardAvoidingProps();
  if (chatKeyboardAvoidingImplementation() === 'native') {
    return (
      <NativeKeyboardAvoidingView testID={testID} style={style} {...props}>
        {children}
      </NativeKeyboardAvoidingView>
    );
  }
  return (
    <KeyboardAvoidingView testID={testID} style={style} {...props}>
      {children}
    </KeyboardAvoidingView>
  );
}

export function ChatKeyboardAvoidingHost({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  useChatKeyboardMotion();
  return (
    <ChatKeyboardAvoiding testID="chat-keyboard-avoiding" style={[styles.host, style]}>
      {children}
    </ChatKeyboardAvoiding>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
});
