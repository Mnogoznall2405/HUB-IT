import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HubButton } from '../components/ui/HubButton';
import { officeTokens } from '../theme/officeTokens';
import { recordDiagnosticEvent, recordReleaseHealthMetric } from './diagnostics';

type State = { failed: boolean };

export class DiagnosticsErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Raw error messages and stacks can contain user content; persist only a fixed event code.
    void recordDiagnosticEvent('ui_render_error');
    void recordReleaseHealthMetric('ui_failures');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.page} accessibilityRole="alert">
        <Text style={styles.title}>Не удалось отобразить экран</Text>
        <Text style={styles.body}>
          Безопасная запись добавлена в локальную диагностику. Попробуйте открыть экран ещё раз.
        </Text>
        <HubButton mode="contained" icon="reload" onPress={() => this.setState({ failed: false })}>
          Повторить
        </HubButton>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    backgroundColor: officeTokens.pageBg,
  },
  title: { color: officeTokens.textPrimary, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  body: { color: officeTokens.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
