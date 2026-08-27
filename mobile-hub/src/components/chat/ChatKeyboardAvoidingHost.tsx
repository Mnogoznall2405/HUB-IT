import type { ReactNode } from 'react';
import { KeyboardAvoidingView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';

export function ChatKeyboardAvoidingHost({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
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
