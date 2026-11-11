import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppFluentTokens } from '../../theme/fluentTokens';

export function HubScreen({
  children,
  style,
  scroll = false,
  keyboardAvoiding = false,
  backgroundColor,
}: {
  children: React.ReactNode;
  style?: ViewProps['style'];
  scroll?: boolean;
  keyboardAvoiding?: boolean;
  backgroundColor?: string;
}) {
  const tokens = useAppFluentTokens();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scroll, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.inner, style]}>{children}</View>
  );

  const body = keyboardAvoiding ? (
    <KeyboardAvoidingView
      style={styles.keyboard}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {content}
    </KeyboardAvoidingView>
  ) : content;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: backgroundColor ?? tokens.pageBg }]}
      edges={['top', 'left', 'right']}
    >
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  inner: { flex: 1, padding: 16 },
  scroll: { flexGrow: 1, padding: 16 },
});
