import { useSegments } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HubButton } from '../components/ui/HubButton';
import { officeTokens } from '../theme/officeTokens';
import { recordDiagnosticEvent, recordReleaseHealthMetric } from './diagnostics';
import { makeSnapshotDiagnostic } from './snapshotDiagnostic';
import { setUiArea } from './uiTiming';
import { useUiKeyTiming } from './uiOpenTiming';
import { noteStartupReady } from './perfProbes';
import { beginScreenLoadTrace } from './screenSettle';

type State = { failed: boolean };

const LINE_BREAK = String.fromCharCode(10);

/** Innermost component names of React's component stack as pseudo stack frames
 * (identifiers from our own code only, no props or content). */
export function componentFrames(componentStack?: string | null): string[] {
  return String(componentStack || '').split(LINE_BREAK)
    .map((line) => line.match(/^\s*(?:at|in)\s+([A-Z][A-Za-z0-9_$]{1,40})/)?.[1])
    .filter((name): name is string => Boolean(name))
    .slice(0, 4)
    .map((name) => `at ${name} (<source>:0:0)`);
}

type BoundaryProps = React.PropsWithChildren<{ scope?: string; stage?: string }>;

/** Screen that failed, from the route template only (never ids or params). */
export function renderFailureLocation(segments: readonly string[]): { scope: string; stage: string } {
  const names = segments.map((segment) => String(segment).toLowerCase());
  const scope = names.find((name) => /^[a-z-]+$/.test(name) && name !== 'shell') || 'other';
  const leaf = names[names.length - 1] || 'root';
  const stage = leaf.startsWith('[')
    ? 'render-thread'
    : `render-${leaf.replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '') || 'screen'}`.slice(0, 48);
  return { scope, stage };
}

class DiagnosticsErrorBoundaryImpl extends React.Component<BoundaryProps, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info?: React.ErrorInfo): void {
    // Raw messages can contain user content: only the sanitized technical snapshot
    // (error type, approved message, frame names + offsets), the route template and
    // the names of the failing components are kept.
    let snapshot;
    try {
      const candidate = error as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown } | null;
      snapshot = makeSnapshotDiagnostic(this.props.scope || 'other', this.props.stage || 'render', {
        name: candidate?.name,
        code: candidate?.code,
        message: candidate?.message,
        stack: [
          ...String(candidate?.stack || '').split(LINE_BREAK).slice(0, 5),
          ...componentFrames(info?.componentStack),
        ].join(LINE_BREAK),
      });
    } catch {
      snapshot = undefined;
    }
    void recordDiagnosticEvent('ui_render_error', snapshot);
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

export function DiagnosticsErrorBoundary({ children }: React.PropsWithChildren) {
  const segments = useSegments();
  const { scope, stage } = renderFailureLocation(segments);
  const area = scope === 'chat' && stage === 'render-thread' ? 'chat-thread' : scope;
  useEffect(() => { setUiArea(area); beginScreenLoadTrace(area); }, [area]);
  useEffect(() => { noteStartupReady(); }, []);
  // TEMPORARY: time from a route change to the screen being painted.
  const screenKey = `screen:${area}`.slice(0, 32);
  useUiKeyTiming(screenKey);
  return <DiagnosticsErrorBoundaryImpl scope={scope} stage={stage}>{children}</DiagnosticsErrorBoundaryImpl>;
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
