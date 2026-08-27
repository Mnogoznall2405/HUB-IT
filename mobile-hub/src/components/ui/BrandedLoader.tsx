import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAppFluentTokens } from '../../theme/fluentTokens';

export function BrandedLoader({ label = 'Загружаем...' }: { label?: string }) {
  const tokens = useAppFluentTokens();
  return (
    <View style={[styles.wrap, { backgroundColor: tokens.pageBg }]}>
      <ActivityIndicator size="large" color={tokens.primary} />
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: { fontSize: 16 },
});
