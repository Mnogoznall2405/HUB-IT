import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { hubTheme } from '../../theme/hubTheme';
import { officeTokens } from '../../theme/officeTokens';

export function BrandedLoader({ label = 'Загружаем...' }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={hubTheme.primary} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: officeTokens.pageBg,
    gap: 12,
  },
  label: { color: hubTheme.textSecondary, fontSize: 16 },
});
