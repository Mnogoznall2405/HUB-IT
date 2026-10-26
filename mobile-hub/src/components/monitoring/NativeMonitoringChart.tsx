import { StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';

/** Столбчатый график без графических зависимостей; `null` — разрыв данных. */
export function NativeMonitoringChart({ title, values, format, color, tokens, testID, height = 64 }: {
  title: string;
  values: Array<number | null>;
  format: (value: number) => string;
  color: string;
  tokens: FluentTokens;
  testID?: string;
  height?: number;
}) {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  const maximum = numbers.length ? Math.max(...numbers) : 0;
  const scale = maximum > 0 ? maximum : 1;
  const latest = [...values].reverse().find((value) => typeof value === 'number');
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: tokens.textSecondary }]}>{title}</Text>
        <Text style={[styles.value, { color: tokens.textPrimary }]}>
          {typeof latest === 'number' ? format(latest) : '—'}
        </Text>
      </View>
      {numbers.length ? (
        <View
          accessible
          accessibilityLabel={`${title}: максимум ${format(maximum)}`}
          style={[styles.plot, { height, borderColor: tokens.borderSoft }]}
        >
          {values.map((value, index) => (
            <View key={index} style={styles.slot}>
              {typeof value === 'number' ? (
                <View style={{ height: Math.max(2, (value / scale) * (height - 4)), backgroundColor: color, borderRadius: 1 }} />
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.empty, { color: tokens.textTertiary }]}>Нет измерений за период</Text>
      )}
      {numbers.length ? (
        <Text style={[styles.caption, { color: tokens.textTertiary }]}>Максимум за период: {format(maximum)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  title: { flex: 1, fontSize: 12, fontWeight: '700' },
  value: { fontSize: 14, fontWeight: '800' },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, borderBottomWidth: StyleSheet.hairlineWidth },
  slot: { flex: 1, justifyContent: 'flex-end' },
  empty: { fontSize: 12, paddingVertical: 10 },
  caption: { fontSize: 11 },
});
