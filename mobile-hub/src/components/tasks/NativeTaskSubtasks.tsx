import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HubTask, TaskParentRef } from '../../api/taskApi';
import { taskStatusLabel } from '../../tasks/taskActions';
import { formatTaskDate, taskPerson, taskSubtaskProgress } from '../../tasks/taskFormat';
import type { FluentTokens } from '../../theme/fluentTokens';
import { AccountSectionCard } from '../../screens/account/AccountChrome';

/** Предупреждение для родителя с невыполненными подзадачами: закрытие не блокируется. */
export function openSubtasksWarning(task: Pick<HubTask, 'subtasks_total' | 'subtasks_done'>): string {
  const { open } = taskSubtaskProgress(task);
  return open > 0 ? `Есть невыполненные подзадачи: ${open}. Закрытие задачи их не блокирует.` : '';
}

export function NativeTaskParentLink({ parent, tokens, onOpen }: {
  parent: TaskParentRef;
  tokens: FluentTokens;
  onOpen: (taskId: string) => void;
}) {
  const label = parent.can_view ? String(parent.title || '').trim() || 'Родительская задача' : 'Родительская задача недоступна';
  const content = (
    <View style={styles.parentRow}>
      <MaterialCommunityIcons name="subdirectory-arrow-right" size={16} color={tokens.iconMuted} />
      <Text numberOfLines={2} style={[styles.parentText, { color: parent.can_view ? tokens.primary : tokens.textSecondary }]}>
        Подзадача · родитель: {label}
      </Text>
    </View>
  );
  if (!parent.can_view) return <View testID="native-task-parent-link">{content}</View>;
  return (
    <Pressable
      testID="native-task-parent-link"
      onPress={() => onOpen(parent.id)}
      accessibilityRole="button"
      accessibilityLabel={`Открыть родительскую задачу: ${label}`}
    >
      {content}
    </Pressable>
  );
}

export function NativeTaskSubtasksCard({ task, tokens, offlineMode = false, onOpenTask, onCreate }: {
  task: HubTask;
  tokens: FluentTokens;
  offlineMode?: boolean;
  onOpenTask: (taskId: string) => void;
  onCreate: () => void;
}) {
  const { total, done } = taskSubtaskProgress(task);
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const canCreate = task.capabilities?.can_create_subtask === true;
  const hidden = Math.max(0, total - subtasks.length);
  if (!total && !canCreate) return null;

  return (
    <AccountSectionCard
      tokens={tokens}
      title={total ? `Подзадачи · ${done}/${total}` : 'Подзадачи'}
      description={total ? undefined : 'Разбейте задачу на части и назначьте их исполнителям.'}
    >
      {subtasks.map((item) => (
        <Pressable
          key={item.id}
          testID={`native-task-subtask-${item.id}`}
          onPress={() => onOpenTask(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`${item.title || 'Подзадача'}. ${taskStatusLabel(item.status)}`}
          style={[styles.row, { borderColor: tokens.borderSoft }]}
        >
          <MaterialCommunityIcons
            name={item.status === 'done' ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
            size={22}
            color={item.status === 'done' ? tokens.success : tokens.iconMuted}
          />
          <View style={styles.rowBody}>
            <Text numberOfLines={2} style={[styles.rowTitle, { color: tokens.textPrimary }]}>{item.title || 'Подзадача'}</Text>
            <Text numberOfLines={1} style={[styles.rowMeta, { color: item.is_overdue ? tokens.error : tokens.textSecondary }]}>
              {taskStatusLabel(item.status)} · {taskPerson(item, 'assignee')}{item.due_at ? ` · ${formatTaskDate(item.due_at)}` : ''}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
        </Pressable>
      ))}
      {hidden > 0 ? (
        <Text testID="native-task-subtasks-hidden" style={[styles.rowMeta, { color: tokens.textSecondary }]}>
          и ещё {hidden} недоступных вам
        </Text>
      ) : null}
      {canCreate ? (
        <Pressable
          testID="native-task-subtask-create"
          onPress={onCreate}
          disabled={offlineMode}
          accessibilityRole="button"
          accessibilityLabel="Добавить подзадачу"
          accessibilityState={{ disabled: offlineMode }}
          style={[styles.addButton, { borderColor: tokens.primary, opacity: offlineMode ? 0.55 : 1 }]}
        >
          <MaterialCommunityIcons name="plus" size={20} color={tokens.primary} />
          <Text style={{ color: tokens.primary, fontWeight: '800' }}>
            {offlineMode ? 'Подзадачу можно добавить только онлайн' : 'Подзадача'}
          </Text>
        </Pressable>
      ) : null}
    </AccountSectionCard>
  );
}

const styles = StyleSheet.create({
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  parentText: { flex: 1, fontSize: 13, fontWeight: '700' },
  row: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  rowMeta: { fontSize: 12, fontWeight: '600' },
  addButton: { marginTop: 10, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
