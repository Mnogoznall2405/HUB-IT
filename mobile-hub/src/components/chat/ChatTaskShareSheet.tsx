import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChatTaskPreview } from '../../api/types';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

export function ChatTaskShareSheet({
  visible,
  tasks,
  loading,
  onClose,
  onSearch,
  onShare,
}: {
  visible: boolean;
  tasks: ChatTaskPreview[];
  loading?: boolean;
  onClose: () => void;
  onSearch: (query: string) => void;
  onShare: (task: ChatTaskPreview) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => normalized
    ? tasks.filter((task) => `${task.title} ${task.assignee_full_name || ''}`.toLowerCase().includes(normalized))
    : tasks, [normalized, tasks]);

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={onClose}>
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть выбор задачи" />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title}>Отправить задачу</Text>
          <TextInput
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              onSearch(value);
            }}
            placeholder="Поиск задачи"
            placeholderTextColor={chatTokens.textSecondary}
            style={styles.search}
            accessibilityLabel="Поиск задачи для отправки"
          />
          {loading ? <ActivityIndicator color={chatTokens.composerActionBg} /> : null}
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {filtered.map((task) => (
              <Pressable
                key={task.id}
                onPress={() => onShare(task)}
                style={({ pressed }) => [styles.task, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Отправить задачу ${task.title}`}
              >
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskMeta}>{[task.status, task.assignee_full_name].filter(Boolean).join(' · ')}</Text>
              </Pressable>
            ))}
            {!loading && !filtered.length ? <Text style={styles.empty}>Задачи не найдены</Text> : null}
          </ScrollView>
        </View>
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: chatTokens.overlayBg },
  sheet: { maxHeight: '78%', padding: 16, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: chatTokens.panelBg },
  title: { marginBottom: 12, color: chatTokens.textPrimary, fontSize: 19, fontWeight: '700' },
  search: { minHeight: 46, paddingHorizontal: 13, borderRadius: 15, color: chatTokens.textPrimary, backgroundColor: chatTokens.sidebarSearchBg },
  list: { marginTop: 8 },
  task: { minHeight: 58, justifyContent: 'center', paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: chatTokens.sidebarDivider },
  taskTitle: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '600' },
  taskMeta: { marginTop: 3, color: chatTokens.textSecondary, fontSize: 12 },
  empty: { padding: 20, color: chatTokens.textSecondary, textAlign: 'center' },
  pressed: { backgroundColor: chatTokens.sidebarRowSoftActive },
});
