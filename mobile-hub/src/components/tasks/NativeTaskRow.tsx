import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HubTask } from '../../api/taskApi';
import { taskStatusLabel } from '../../tasks/taskActions';
import { formatTaskDate, taskPerson, taskPriorityLabel, taskSubtaskProgress } from '../../tasks/taskFormat';
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
  const personLabel = personRole === 'created_by' ? 'Поставил' : 'Исполнители';
  const hasAttachments = Boolean(task.has_attachments) || Boolean(task.attachments?.length);
  const subtasks = taskSubtaskProgress(task);
  const isSubtask = Boolean(task.parent_task_id);

  return (
    <Pressable
      testID={`native-task-row-${task.id}`}
      onPress={() => onPress(task)}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${status}. Срок: ${due}`}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: tokens.borderSoft },
        pressed && { backgroundColor: tokens.actionHover },
      ]}
    >
      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
        <View style={styles.metaRow}>
          <Text style={[styles.statusText, { color: accent }]}>{status}</Text>
          <Text numberOfLines={1} style={[styles.metaText, { color: overdue ? tokens.error : tokens.textSecondary }]}>
            {overdue ? `Просрочено · ${due}` : due}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.metaText, { color: tokens.textSecondary }]}>
          {personLabel}: {taskPerson(task, personRole)} · {priority}
        </Text>
        {task.has_unread_comments || hasAttachments || subtasks.total > 0 || isSubtask ? (
          <View style={styles.signalRow}>
            {isSubtask ? (
              <View style={styles.signalItem}>
                <MaterialCommunityIcons name="subdirectory-arrow-right" size={14} color={tokens.iconMuted} />
                <Text style={[styles.signalText, { color: tokens.textSecondary }]}>Подзадача</Text>
              </View>
            ) : null}
            {subtasks.total > 0 ? (
              <View style={styles.signalItem}>
                <MaterialCommunityIcons name="source-branch" size={14} color={tokens.primary} />
                <Text testID={`native-task-row-subtasks-${task.id}`} style={[styles.signalText, { color: tokens.primary }]}>
                  Подзадачи {subtasks.done}/{subtasks.total}
                </Text>
              </View>
            ) : null}
            {task.has_unread_comments ? (
              <View style={styles.signalItem}>
                <MaterialCommunityIcons name="message-badge-outline" size={14} color={tokens.primary} />
                <Text style={[styles.signalText, { color: tokens.primary }]}>Новые комментарии</Text>
              </View>
            ) : null}
            {hasAttachments ? (
              <View style={styles.signalItem}>
                <MaterialCommunityIcons name="paperclip" size={14} color={tokens.iconMuted} />
                <Text style={[styles.signalText, { color: tokens.textSecondary }]}>Есть файлы</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} style={styles.chevron} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  body: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { fontSize: 12, fontWeight: '800' },
  metaText: { flexShrink: 1, minWidth: 0, fontSize: 13, fontWeight: '600' },
  signalRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  signalItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  signalText: { fontSize: 12, fontWeight: '700' },
  chevron: { marginTop: 2 },
});
