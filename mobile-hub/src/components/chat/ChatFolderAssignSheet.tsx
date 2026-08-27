import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  isConversationInFolder,
  type ChatCustomFolder,
} from '../../chat/chatFolders';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export function ChatFolderAssignSheet({
  conversation,
  folders,
  conversationIdsByFolder,
  busy = false,
  onClose,
  onToggle,
}: {
  conversation: ChatConversationSummary | null;
  folders: ChatCustomFolder[];
  conversationIdsByFolder: Record<string, string[]>;
  busy?: boolean;
  onClose: () => void;
  onToggle: (folderId: string, included: boolean) => void;
}) {
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const visible = Boolean(conversation);
  const title = conversation?.title || 'Диалог';

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть выбор папки"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title} numberOfLines={1}>Добавить в папку</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{title}</Text>
          <ScrollView contentContainerStyle={styles.list}>
            {folders.map((folder) => {
              const included = isConversationInFolder(
                conversation?.id || '',
                folder.id,
                conversationIdsByFolder,
              );
              return (
                <Pressable
                  key={folder.id}
                  onPress={() => onToggle(folder.id, !included)}
                  disabled={busy}
                  style={({ pressed }) => [styles.row, included && styles.rowActive, pressed && styles.pressed]}
                  accessibilityRole="checkbox"
                  accessibilityLabel={folder.name}
                  accessibilityState={{ checked: included, disabled: busy }}
                >
                  <Text style={styles.check}>{included ? '✓' : ''}</Text>
                  <Text style={styles.folderName}>{folder.name}</Text>
                </Pressable>
              );
            })}
            {!folders.length ? (
              <Text style={styles.empty}>Сначала создайте папку</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: chatTokens.overlayBg },
  sheet: {
    maxHeight: '72%',
    overflow: 'hidden',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: chatTokens.panelBg,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, marginTop: 8, borderRadius: 2, backgroundColor: chatTokens.borderSoft },
  title: { paddingHorizontal: 16, paddingTop: 12, color: chatTokens.textPrimary, fontSize: 19, fontWeight: '700' },
  subtitle: { paddingHorizontal: 16, paddingTop: 4, color: chatTokens.textSecondary, fontSize: 14 },
  list: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 24 },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderRadius: 12 },
  rowActive: { backgroundColor: chatTokens.sidebarRowSoftActive },
  check: { width: 30, color: chatTokens.accentText, fontSize: 20, fontWeight: '700' },
  folderName: { flex: 1, color: chatTokens.textPrimary, fontSize: 16 },
  empty: { padding: 24, color: chatTokens.textSecondary, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
