import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChatUserSummary } from '../../api/types';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

export function ChatRenameSheet({
  visible,
  initialTitle,
  busy,
  heading = 'Название группы',
  inputLabel = 'Новое название группы',
  onClose,
  onSave,
}: {
  visible: boolean;
  initialTitle: string;
  busy?: boolean;
  heading?: string;
  inputLabel?: string;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => {
    if (visible) setTitle(initialTitle);
  }, [initialTitle, visible]);
  const close = () => {
    setTitle(initialTitle);
    onClose();
  };
  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'fade'} transparent onRequestClose={close}>
      <ChatKeyboardAvoidingHost style={styles.centerBackdrop}>
        <View style={styles.prompt} accessibilityViewIsModal>
          <Text style={styles.title}>{heading}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            autoFocus
            maxLength={255}
            style={styles.search}
            accessibilityLabel={inputLabel}
          />
          <View style={styles.actions}>
            <Action label="Отмена" onPress={close} />
            <Action
              label="Сохранить"
              onPress={() => onSave(title.trim())}
              disabled={busy || !title.trim() || title.trim() === initialTitle.trim()}
              primary
            />
          </View>
        </View>
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

export function ChatMemberPickerSheet({
  visible,
  users,
  excludedUserIds,
  busy,
  onClose,
  onAdd,
}: {
  visible: boolean;
  users: ChatUserSummary[];
  excludedUserIds: number[];
  busy?: boolean;
  onClose: () => void;
  onAdd: (userIds: number[]) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const excluded = useMemo(() => new Set(excludedUserIds), [excludedUserIds]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      if (excluded.has(user.id)) return false;
      return !normalized || `${user.full_name || ''} ${user.username}`.toLowerCase().includes(normalized);
    });
  }, [excluded, query, users]);
  const close = () => {
    setQuery('');
    setSelected([]);
    onClose();
  };

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={close}>
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title}>Добавить участников</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск по имени"
            placeholderTextColor={chatTokens.textSecondary}
            style={styles.search}
            accessibilityLabel="Поиск участников"
          />
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {filtered.map((user) => {
              const picked = selected.includes(user.id);
              const label = user.full_name || user.username;
              return (
                <Pressable
                  key={user.id}
                  onPress={() => setSelected((current) => picked
                    ? current.filter((id) => id !== user.id)
                    : [...current, user.id])}
                  style={({ pressed }) => [styles.userRow, picked && styles.selected, pressed && styles.pressed]}
                  accessibilityRole="checkbox"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: picked }}
                >
                  <Text style={styles.check}>{picked ? '✓' : ''}</Text>
                  <View style={styles.userText}>
                    <Text style={styles.userName}>{label}</Text>
                    <Text style={styles.userMeta}>@{user.username}</Text>
                  </View>
                </Pressable>
              );
            })}
            {!filtered.length ? <Text style={styles.empty}>Доступных пользователей нет</Text> : null}
          </ScrollView>
          <View style={styles.actions}>
            <Action label="Отмена" onPress={close} />
            <Action
              label={`Добавить${selected.length ? ` (${selected.length})` : ''}`}
              onPress={() => onAdd(selected)}
              disabled={busy || !selected.length}
              primary
            />
          </View>
        </View>
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

function Action({ label, onPress, disabled, primary }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: chatTokens.overlayBg },
  centerBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: chatTokens.overlayBg },
  sheet: { maxHeight: '84%', padding: 16, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: chatTokens.panelBg },
  prompt: { padding: 18, borderRadius: 18, backgroundColor: chatTokens.panelBg },
  title: { marginBottom: 12, color: chatTokens.textPrimary, fontSize: 19, fontWeight: '700' },
  search: { minHeight: 46, paddingHorizontal: 13, borderRadius: 14, color: chatTokens.textPrimary, backgroundColor: chatTokens.sidebarSearchBg },
  list: { maxHeight: 400, marginTop: 8 },
  userRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderRadius: 12 },
  selected: { backgroundColor: chatTokens.sidebarRowSoftActive },
  check: { width: 30, color: chatTokens.accentText, fontSize: 20, fontWeight: '700' },
  userText: { flex: 1 },
  userName: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '600' },
  userMeta: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  action: { minHeight: 44, minWidth: 92, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12 },
  actionPrimary: { backgroundColor: chatTokens.composerActionBg },
  actionText: { color: chatTokens.accentText, fontSize: 15, fontWeight: '700' },
  actionTextPrimary: { color: chatTokens.composerActionText },
  empty: { padding: 20, color: chatTokens.textSecondary, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
