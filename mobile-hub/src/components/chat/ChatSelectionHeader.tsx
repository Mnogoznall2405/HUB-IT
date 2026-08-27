import { StyleSheet, Text, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export function ChatSelectionHeader({
  count,
  canReply,
  canDelete,
  onClose,
  onReply,
  onForward,
  onCopy,
  onDelete,
}: {
  count: number;
  canReply: boolean;
  canDelete: boolean;
  onClose: () => void;
  onReply: () => void;
  onForward: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <View style={styles.wrap} accessibilityRole="toolbar">
      <IconButton icon="close" onPress={onClose} accessibilityLabel="Готово" />
      <Text style={styles.count} accessibilityRole="header">
        {count}
      </Text>
      {canReply ? (
        <IconButton icon="reply" onPress={onReply} accessibilityLabel="Ответить" />
      ) : null}
      <IconButton icon="share" onPress={onForward} accessibilityLabel="Переслать" />
      <IconButton icon="content-copy" onPress={onCopy} accessibilityLabel="Копировать" />
      {canDelete ? (
        <IconButton icon="delete-outline" onPress={onDelete} accessibilityLabel="Удалить" />
      ) : null}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: chatTokens.threadTopbarBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.borderSoft,
    paddingRight: 4,
  },
  count: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: chatTokens.textPrimary,
  },
});
