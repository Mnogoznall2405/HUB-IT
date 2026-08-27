import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HubTask } from '../../api/taskApi';
import { taskStatusLabel } from '../../tasks/taskActions';
import { formatTaskDate, taskPerson, taskPriorityLabel } from '../../tasks/taskFormat';
import type { FluentTokens } from '../../theme/fluentTokens';

export const NativeTaskRow = memo(function NativeTaskRow({ task, tokens, personRole = 'assignee', onPress }: {
  task: HubTask;
  tokens: FluentTokens;
  personRole?: 'assignee' | 'created_by';
  onPress: (task: HubTask) => void;
}) {
  const status = taskStatusLabel(task.status);
  const due = formatTaskDate(task.due_at);
  const overdue = Boolean(task.is_overdue);
  const priority = taskPriorityLabel(task.priority);
  const accent = overdue ? tokens.error : task.status === 'done' ? tokens.success : tokens.primary;
  const title = String(task.title || '').trim() || 'Задача';
  const personLabel = personRole === 'created_by' ? 'Поставил' : 'Исполнитель';
  const hasAttachments = Boolean(task.has_attachments) || Boolean(task.attachments?.length);

  return (
    <Pressable
      testID={`native-task-row-${task.id}`}
      onPress={() => onPress(task)}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${status}. Срок: ${due}`}
      style={({ pressed }) => [styles.card, {
        backgroundColor: tokens.panelSolid,
        borderColor: overdue ? `${tokens.error}55` : tokens.borderSoft,
        opacity: pressed ? 0.84 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      }]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
        </View>
        <View style={styles.metaRow}>
          <View style={[styles.statusChip, { backgroundColor: `${accent}18` }]}>
            <Text style={[styles.statusText, { color: accent }]}>{status}</Text>
          </View>
          <Text style={[styles.metaText, { color: overdue ? tokens.error : tokens.textSecondary }]}>
            {overdue ? `Просрочено · ${due}` : due}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.metaText, { color: tokens.textSecondary }]}>
          {personLabel}: {taskPerson(task, personRole)} · {priority}
        </Text>
        {task.has_unread_comments || hasAttachments ? (
          <View style={styles.signalRow}>
            {task.has_unread_comments ? (
              <View style={styles.signalItem}>
                <MaterialCommunityIcons name="message-badge-outline" size={16} color={tokens.primary} />
                <Text style={[styles.signalText, { color: tokens.primary }]}>Новые комментарии</Text>
              </View>
            ) : null}
            {hasAttachments ? (
              <View style={styles.signalItem}>
                <MaterialCommunityIcons name="paperclip" size={16} color={tokens.iconMuted} />
                <Text style={[styles.signalText, { color: tokens.textSecondary }]}>Есть файлы</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { minHeight: 112, borderWidth: 1, borderRadius: 16, overflow: 'hidden', flexDirection: 'row', marginBottom: 10 },
  accent: { width: 4 },
  body: { flex: 1, minWidth: 0, padding: 12, gap: 7 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  statusChip: { minHeight: 26, borderRadius: 13, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  statusText: { fontSize: 12, fontWeight: '800' },
  metaText: { fontSize: 12, fontWeight: '600' },
  signalRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  signalItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  signalText: { fontSize: 12, fontWeight: '800' },
});
