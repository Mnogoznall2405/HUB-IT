import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import type { ChatCustomFolder } from '../../chat/chatFolders';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

export function ChatFolderManagerSheet({
  visible,
  folders,
  busy = false,
  onClose,
  onCreate,
  onRename,
  onDelete,
}: {
  visible: boolean;
  folders: ChatCustomFolder[];
  busy?: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (folderId: string, name: string) => void;
  onDelete: (folderId: string) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [prompt, setPrompt] = useState<{ mode: 'create' } | { mode: 'rename'; folder: ChatCustomFolder } | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!visible) {
      setPrompt(null);
      setName('');
    }
  }, [visible]);

  const closePrompt = () => {
    setPrompt(null);
    setName('');
  };

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={prompt ? closePrompt : onClose}
    >
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={prompt ? closePrompt : onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть управление папками"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          {prompt ? (
            <View style={styles.prompt}>
              <Text style={styles.title}>
                {prompt.mode === 'create' ? 'Новая папка' : 'Переименовать папку'}
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                autoFocus
                maxLength={80}
                placeholder="Название"
                placeholderTextColor={chatTokens.textSecondary}
                style={styles.input}
                accessibilityLabel="Название папки"
              />
              <View style={styles.actions}>
                <Action label="Отмена" onPress={closePrompt} />
                <Action
                  label={prompt.mode === 'create' ? 'Создать' : 'Сохранить'}
                  primary
                  disabled={busy || !name.trim()}
                  onPress={() => {
                    const nextName = name.trim();
                    if (!nextName) return;
                    if (prompt.mode === 'create') onCreate(nextName);
                    else onRename(prompt.folder.id, nextName);
                    closePrompt();
                  }}
                />
              </View>
            </View>
          ) : (
            <>
              <View style={styles.handle} />
              <View style={styles.header}>
                <Text style={styles.title}>Папки</Text>
                <Pressable
                  onPress={() => {
                    setName('');
                    setPrompt({ mode: 'create' });
                  }}
                  style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Создать папку"
                >
                  <Text style={styles.createText}>Создать</Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
                {folders.map((folder) => (
                  <View key={folder.id} style={styles.row}>
                    <Text style={styles.folderName} numberOfLines={1}>{folder.name}</Text>
                    <Pressable
                      onPress={() => {
                        setName(folder.name);
                        setPrompt({ mode: 'rename', folder });
                      }}
                      style={styles.rowAction}
                      accessibilityRole="button"
                      accessibilityLabel={`Переименовать папку ${folder.name}`}
                    >
                      <Text style={styles.rowActionText}>Имя</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onDelete(folder.id)}
                      style={styles.rowAction}
                      accessibilityRole="button"
                      accessibilityLabel={`Удалить папку ${folder.name}`}
                    >
                      <Text style={[styles.rowActionText, styles.danger]}>Удалить</Text>
                    </Pressable>
                  </View>
                ))}
                {!folders.length ? (
                  <Text style={styles.empty}>Пользовательских папок пока нет</Text>
                ) : null}
              </ScrollView>
            </>
          )}
        </View>
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

function Action({
  label,
  onPress,
  disabled,
  primary,
}: {
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
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
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
  sheet: {
    maxHeight: '84%',
    overflow: 'hidden',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: chatTokens.panelBg,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, marginTop: 8, borderRadius: 2, backgroundColor: chatTokens.borderSoft },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  title: { flex: 1, color: chatTokens.textPrimary, fontSize: 19, fontWeight: '700' },
  createButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  createText: { color: chatTokens.accentText, fontSize: 15, fontWeight: '700' },
  list: { paddingHorizontal: 8, paddingBottom: 24 },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  folderName: { flex: 1, color: chatTokens.textPrimary, fontSize: 16, fontWeight: '600' },
  rowAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  rowActionText: { color: chatTokens.accentText, fontSize: 14, fontWeight: '700' },
  danger: { color: chatTokens.dangerText },
  empty: { padding: 24, color: chatTokens.textSecondary, textAlign: 'center' },
  prompt: { padding: 18, paddingBottom: 28 },
  input: {
    minHeight: 46,
    marginTop: 12,
    paddingHorizontal: 13,
    borderRadius: 14,
    color: chatTokens.textPrimary,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  action: { minHeight: 44, minWidth: 92, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12 },
  actionPrimary: { backgroundColor: chatTokens.composerActionBg },
  actionText: { color: chatTokens.accentText, fontSize: 15, fontWeight: '700' },
  actionTextPrimary: { color: chatTokens.composerActionText },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
