import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useAppFluentTokens } from '../../theme/fluentTokens';

export function HubCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewProps['style'];
}) {
  const tokens = useAppFluentTokens();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
});
