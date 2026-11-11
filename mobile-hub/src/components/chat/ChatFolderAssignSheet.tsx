import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import {
  isConversationInFolder,
  type ChatCustomFolder,
} from '../../chat/chatFolders';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatBottomSheet } from './ChatBottomSheet';

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
  const { styles, chatTokens } = useChatStyles(createStyles);
  const visible = Boolean(conversation);
  const title = conversation?.title || 'Диалог';

  return (
    <ChatBottomSheet
      visible={visible}
      onClose={onClose}
      dismissAccessibilityLabel="Закрыть выбор папки"
      sheetStyle={styles.sheet}
    >
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
              {included ? (
                <MaterialCommunityIcons name="check" size={20} color={chatTokens.composerActionBg} />
              ) : (
                <View style={styles.check} />
              )}
              <Text style={styles.folderName}>{folder.name}</Text>
            </Pressable>
          );
        })}
        {!folders.length ? (
          <Text style={styles.empty}>Сначала создайте папку</Text>
        ) : null}
      </ScrollView>
    </ChatBottomSheet>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  sheet: { maxHeight: '72%' },
  title: { paddingHorizontal: 16, paddingTop: 8, color: chatTokens.textPrimary, fontSize: 19, fontWeight: '700' },
  subtitle: { paddingHorizontal: 16, paddingTop: 4, color: chatTokens.textSecondary, fontSize: 14 },
  list: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 24 },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderRadius: 12 },
  rowActive: { backgroundColor: chatTokens.sidebarRowSoftActive },
  check: { width: 30 },
  folderName: { flex: 1, color: chatTokens.textPrimary, fontSize: 16 },
  empty: { padding: 24, color: chatTokens.textSecondary, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
