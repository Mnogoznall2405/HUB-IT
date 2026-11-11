import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_FORMATTER = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const DAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLabel(value: string): string {
  const parsed = parseIsoDate(value);
  return parsed ? DAY_FORMATTER.format(parsed) : value;
}

function buildMonthCells(cursor: Date): Array<Date | null> {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: startOffset }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function NativeMailDateField({ testID, label, value, tokens, onChange }: {
  testID: string;
  label: string;
  value: string;
  tokens: FluentTokens;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => parseIsoDate(value) || new Date());
  const cells = useMemo(() => buildMonthCells(cursor), [cursor]);
  const todayIso = toIsoDate(new Date());
  const monthTitle = MONTH_FORMATTER.format(cursor);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatLabel(value) : 'не выбрана'}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          const parsed = parseIsoDate(value);
          if (parsed) setCursor(parsed);
          setOpen((current) => !current);
        }}
        style={({ pressed }) => [styles.fieldButton, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft, opacity: pressed ? 0.8 : 1 }]}
      >
        <MaterialCommunityIcons name="calendar-outline" size={19} color={tokens.iconMuted} />
        <Text style={[styles.fieldValue, { color: value ? tokens.textPrimary : tokens.textTertiary }]}>
          {value ? formatLabel(value) : 'Выбрать дату'}
        </Text>
        {value ? (
          <Pressable
            testID={`${testID}-clear`}
            accessibilityRole="button"
            accessibilityLabel={`Очистить дату: ${label.toLowerCase()}`}
            hitSlop={8}
            onPress={() => onChange('')}
            style={styles.clearButton}
          >
            <MaterialCommunityIcons name="close" size={17} color={tokens.iconMuted} />
          </Pressable>
        ) : null}
      </Pressable>
      {open ? (
        <View testID={`${testID}-calendar`} style={[styles.calendar, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
          <View style={styles.calendarHeader}>
            <Pressable
              testID={`${testID}-prev-month`}
              accessibilityRole="button"
              accessibilityLabel="Предыдущий месяц"
              onPress={() => setCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              style={styles.monthNav}
            >
              <MaterialCommunityIcons name="chevron-left" size={22} color={tokens.iconMuted} />
            </Pressable>
            <Text style={[styles.monthTitle, { color: tokens.textPrimary }]}>{monthTitle}</Text>
            <Pressable
              testID={`${testID}-next-month`}
              accessibilityRole="button"
              accessibilityLabel="Следующий месяц"
              onPress={() => setCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              style={styles.monthNav}
            >
              <MaterialCommunityIcons name="chevron-right" size={22} color={tokens.iconMuted} />
            </Pressable>
          </View>
          <View style={styles.weekRow}>
            {WEEKDAYS.map((day) => <Text key={day} style={[styles.weekday, { color: tokens.textSecondary }]}>{day}</Text>)}
          </View>
          <View style={styles.grid}>
            {cells.map((day, index) => {
              if (!day) return <View key={`empty-${index}`} style={styles.dayCell} />;
              const iso = toIsoDate(day);
              const selected = iso === value;
              const today = iso === todayIso;
              return (
                <Pressable
                  key={iso}
                  testID={`${testID}-day-${iso}`}
                  accessibilityRole="button"
                  accessibilityLabel={DAY_FORMATTER.format(day)}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  style={[styles.dayCell, styles.dayButton, {
                    backgroundColor: selected ? tokens.primary : 'transparent',
                    borderColor: today && !selected ? tokens.selectedBorder : 'transparent',
                  }]}
                >
                  <Text style={[styles.dayText, { color: selected ? '#fff' : today ? tokens.primary : tokens.textPrimary }]}>{day.getDate()}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexGrow: 1, minWidth: 150 },
  label: { marginBottom: 5, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  fieldButton: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldValue: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' },
  clearButton: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  calendar: { marginTop: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthNav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '800', textTransform: 'capitalize' },
  weekRow: { marginTop: 6, flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, lineHeight: 18, fontWeight: '800' },
  grid: { marginTop: 4, flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  dayButton: { borderWidth: 1, borderRadius: 10 },
  dayText: { fontSize: 13, fontWeight: '700' },
});
