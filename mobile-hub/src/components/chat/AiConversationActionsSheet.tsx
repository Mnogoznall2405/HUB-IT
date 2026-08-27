import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export function AiConversationActionsSheet({
  conversation,
  onClose,
  onRename,
  onResetContext,
  onDelete,
}: {
  conversation: ChatConversationSummary | null;
  onClose: () => void;
  onRename: (conversation: ChatConversationSummary) => void;
  onResetContext: (conversation: ChatConversationSummary) => void;
  onDelete: (conversation: ChatConversationSummary) => void;
}) {
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  if (!conversation) return null;
  return (
    <Modal
      visible
      animationType={reduceMotion ? 'none' : 'fade'}
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть действия с AI-чатом"
        />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} numberOfLines={2}>{conversation.title || 'AI-чат'}</Text>
          <Action label="Переименовать" onPress={() => onRename(conversation)} />
          <Action label="Сбросить контекст" onPress={() => onResetContext(conversation)} />
          <Action label="Удалить чат" danger onPress={() => onDelete(conversation)} />
          <Action label="Отмена" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Action({
  label,
  danger = false,
  onPress,
}: {
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  card: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 10,
    backgroundColor: chatTokens.panelBg,
  },
  title: {
    marginHorizontal: 8,
    marginBottom: 10,
    color: chatTokens.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12 },
  actionText: { color: chatTokens.textPrimary, fontSize: 16, fontWeight: '600' },
  danger: { color: chatTokens.dangerText },
  pressed: { opacity: 0.8 },
});
