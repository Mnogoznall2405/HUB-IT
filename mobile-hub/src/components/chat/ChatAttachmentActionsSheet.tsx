import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatAttachment } from '../../api/types';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatBottomSheet } from './ChatBottomSheet';
import { formatChatFileSize, getChatFileExtension } from './ChatDocumentAttachment';

type AttachmentAction = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
};

export function ChatAttachmentActionsSheet({
  attachment,
  onClose,
  onOpen,
  onShare,
  onForward,
  onSave,
}: {
  attachment: ChatAttachment | null;
  onClose: () => void;
  onOpen: () => void;
  onShare: () => void;
  onForward: () => void;
  onSave: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  const fileName = String(attachment?.file_name || 'Вложение').trim() || 'Вложение';
  const extension = getChatFileExtension(fileName, attachment?.mime_type);
  const size = formatChatFileSize(attachment?.file_size);
  const actions: AttachmentAction[] = [
    { icon: 'open-in-new', label: 'Открыть', onPress: onOpen },
    { icon: 'share-variant-outline', label: 'Поделиться', onPress: onShare },
    { icon: 'forward', label: 'Переслать', onPress: onForward },
    { icon: 'folder-download-outline', label: 'Сохранить в «Мои файлы»', onPress: onSave },
  ];

  const run = (action: AttachmentAction) => {
    onClose();
    action.onPress();
  };

  return (
    <ChatBottomSheet
      visible={Boolean(attachment)}
      onClose={onClose}
      dismissAccessibilityLabel="Закрыть действия с вложением"
      sheetStyle={styles.sheet}
      backdropTestID="chat-attachment-actions-backdrop"
    >
          <View style={styles.header}>
            <View style={styles.fileBadge}>
              <Text style={styles.fileBadgeText}>{extension}</Text>
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title} numberOfLines={1} ellipsizeMode="middle">{fileName}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {[extension, size].filter(Boolean).join(' • ')}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={() => run(action)}
                style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <MaterialCommunityIcons name={action.icon} size={23} color={styles.actionIcon.color} />
                <Text style={styles.actionLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.actionPressed]}
            accessibilityRole="button"
            accessibilityLabel="Отмена"
          >
            <Text style={styles.cancelLabel}>Отмена</Text>
          </Pressable>
    </ChatBottomSheet>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  sheet: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: chatTokens.borderSoft,
    borderRadius: 22,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  fileBadge: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: chatTokens.sidebarRowSoftActive,
  },
  fileBadgeText: { color: chatTokens.accentText, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  headerCopy: { minWidth: 0, flex: 1, marginLeft: 12 },
  title: { color: chatTokens.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  subtitle: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 13, lineHeight: 18 },
  actions: {
    overflow: 'hidden',
    borderRadius: 15,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  action: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  actionPressed: { opacity: 0.72, backgroundColor: chatTokens.sidebarRowSoftActive },
  actionIcon: { color: chatTokens.accentText },
  actionLabel: { marginLeft: 14, color: chatTokens.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: '600' },
  cancel: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderRadius: 14,
  },
  cancelLabel: { color: chatTokens.accentText, fontSize: 16, fontWeight: '700' },
});
