import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

type ConversationAction = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
};

export function ChatConversationActionsSheet({
  conversation,
  onClose,
  onTogglePin,
  onToggleMute,
  onToggleArchive,
  onFolders,
}: {
  conversation: ChatConversationSummary | null;
  onClose: () => void;
  onTogglePin: (conversation: ChatConversationSummary) => void;
  onToggleMute: (conversation: ChatConversationSummary) => void;
  onToggleArchive: (conversation: ChatConversationSummary) => void;
  onFolders: (conversation: ChatConversationSummary) => void;
}) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  if (!conversation) return null;

  const actions: ConversationAction[] = [
    {
      icon: conversation.is_pinned ? 'pin-off-outline' : 'pin-outline',
      label: conversation.is_pinned ? 'Открепить' : 'Закрепить',
      onPress: () => onTogglePin(conversation),
    },
    {
      icon: conversation.is_muted ? 'bell-outline' : 'bell-off-outline',
      label: conversation.is_muted ? 'Включить уведомления' : 'Выключить уведомления',
      onPress: () => onToggleMute(conversation),
    },
    {
      icon: conversation.is_archived ? 'archive-arrow-up-outline' : 'archive-outline',
      label: conversation.is_archived ? 'Вернуть из архива' : 'Архивировать',
      onPress: () => onToggleArchive(conversation),
    },
    {
      icon: 'folder-plus-outline',
      label: 'Добавить в папку',
      onPress: () => onFolders(conversation),
    },
  ];

  return (
    <Modal
      visible
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть действия с диалогом"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
            {conversation.title || 'Диалог'}
          </Text>
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={action.onPress}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <View style={styles.iconWrap}>
                  <MaterialCommunityIcons
                    name={action.icon}
                    size={23}
                    color={chatTokens.accentText}
                  />
                </View>
                <Text style={styles.actionText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Отмена"
          >
            <Text style={styles.cancelText}>Отмена</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: chatTokens.overlayBg,
  },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 12,
    backgroundColor: chatTokens.panelBg,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    marginTop: 8,
    borderRadius: 2,
    backgroundColor: chatTokens.borderSoft,
  },
  title: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    color: chatTokens.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  actions: { paddingHorizontal: 8 },
  action: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  iconWrap: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: chatTokens.sidebarRowSoftActive,
  },
  actionText: {
    flex: 1,
    marginLeft: 12,
    color: chatTokens.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  cancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    marginTop: 4,
    borderRadius: 14,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  cancelText: { color: chatTokens.textPrimary, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
