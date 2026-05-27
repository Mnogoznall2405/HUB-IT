import React from 'react';
import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { officeTokens } from '../../theme/officeTokens';

export function HubScreen({
  children,
  style,
  scroll = false,
  backgroundColor = officeTokens.pageBg,
}: {
  children: React.ReactNode;
  style?: ViewProps['style'];
  scroll?: boolean;
  backgroundColor?: string;
}) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={[styles.scroll, style]}>{children}</ScrollView>
  ) : (
    <View style={[styles.inner, style]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]} edges={['top', 'left', 'right']}>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  inner: { flex: 1, padding: 16 },
  scroll: { flexGrow: 1, padding: 16 },
});
