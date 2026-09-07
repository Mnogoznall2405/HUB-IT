import type { ReactNode } from 'react';
import { KeyboardAvoidingView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import { useChatKeyboardMotion } from '../../chat/useChatKeyboardMotion';

export function ChatKeyboardAvoidingHost({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  useChatKeyboardMotion();
  return (
    <KeyboardAvoidingView
      testID="chat-keyboard-avoiding"
      style={[styles.host, style]}
      {...chatKeyboardAvoidingProps()}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
});
