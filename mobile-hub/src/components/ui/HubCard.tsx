import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { officeTokens } from '../../theme/officeTokens';
import { hubTheme } from '../../theme/hubTheme';

export function HubCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewProps['style'];
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: officeTokens.panelSolid,
    borderRadius: hubTheme.borderRadius,
    borderWidth: 1,
    borderColor: officeTokens.borderSoft,
    padding: 16,
  },
});
