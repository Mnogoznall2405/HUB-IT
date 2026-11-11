import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DocflowTaskSummary } from '../../api/docflowApi';
import {
  docflowTaskStatus,
  formatDocflowDate,
  isDocflowTaskOverdue,
} from '../../docflow/nativeDocflowModel';
import type { FluentTokens } from '../../theme/fluentTokens';

export const NativeDocflowTaskCard = memo(function NativeDocflowTaskCard({
  task,
  tokens,
  onPress,
}: {
  task: DocflowTaskSummary;
  tokens: FluentTokens;
  onPress: (taskRef: string) => void;
}) {
  const overdue = isDocflowTaskOverdue(task);
  const date = task.completed
    ? formatDocflowDate(task.completed_at)
    : formatDocflowDate(task.due_at || task.created_at);
  return (
    <Pressable
      testID={`native-docflow-task-${task.ref}`}
      onPress={() => onPress(task.ref)}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${docflowTaskStatus(task)}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: tokens.panelSolid,
          borderColor: overdue ? tokens.error : tokens.borderSoft,
          opacity: pressed ? 0.74 : 1,
        },
      ]}
    >
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: task.completed ? tokens.selected : tokens.accentSoft }]}>
          <MaterialCommunityIcons
            name={task.completed ? 'check-circle-outline' : 'file-document-outline'}
            size={22}
            color={task.completed ? tokens.success : tokens.primary}
          />
        </View>
        <View style={styles.body}>
          <Text numberOfLines={3} style={[styles.title, { color: tokens.textPrimary }]}>{task.title}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.status, { color: task.completed ? tokens.success : tokens.primary }]}>{docflowTaskStatus(task)}</Text>
            {task.task_type_label ? (
              <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>{task.task_type_label}</Text>
            ) : null}
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={21} color={tokens.iconMuted} />
      </View>
      {task.author || date ? (
        <View style={styles.footer}>
          {task.author ? <Text numberOfLines={1} style={[styles.footerText, { color: tokens.textSecondary }]}>{task.author}</Text> : <View />}
          {date ? <Text style={[styles.date, { color: overdue ? tokens.error : tokens.textSecondary }]}>{overdue ? 'Просрочено · ' : ''}{date}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { minHeight: 92, borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 9 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  metaRow: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  status: { fontSize: 11, lineHeight: 15, fontWeight: '800' },
  meta: { flexShrink: 1, fontSize: 11, lineHeight: 15 },
  footer: { marginTop: 9, paddingLeft: 52, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  footerText: { flex: 1, minWidth: 0, fontSize: 11 },
  date: { fontSize: 10, fontWeight: '700' },
});
