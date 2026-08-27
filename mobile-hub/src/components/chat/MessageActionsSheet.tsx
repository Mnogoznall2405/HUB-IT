import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import type { ChatMessage } from '../../api/types';
import {
  placeMessageActionMenu,
  type ChatMenuAnchor,
} from '../../chat/chatMessageMenuLayout';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export const MESSAGE_MENU_REACTIONS = ['❤️', '👍', '🗿', '🔥', '👎', '🥰', '👏', '😁'] as const;
export const MESSAGE_MENU_REACTIONS_EXPANDED = ['🤔', '😂', '😮', '😢', '🎉', '💯', '👀', '⚡'] as const;

const ALL_MESSAGE_MENU_REACTIONS = [
  ...MESSAGE_MENU_REACTIONS,
  ...MESSAGE_MENU_REACTIONS_EXPANDED,
] as const;
const COLLAPSED_REACTION_COUNT = 5;

type Props = {
  message: ChatMessage | null;
  isOwn: boolean;
  onClose: () => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onReaction: (message: ChatMessage, emoji: string) => void;
  onCopyText?: (message: ChatMessage) => void;
  onCopyLink?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onReads?: (message: ChatMessage) => void;
  onOpenTask?: (message: ChatMessage) => void;
  onReport?: (message: ChatMessage) => void;
  onSelect?: (message: ChatMessage) => void;
  pinnedMessageId?: string | null;
  anchor?: ChatMenuAnchor | null;
};

export function MessageActionsSheet({
  message,
  isOwn,
  onClose,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onReaction,
  onCopyText,
  onCopyLink,
  onPin,
  onReads,
  onOpenTask,
  onReport,
  onSelect,
  pinnedMessageId,
  anchor = null,
}: Props) {
  const { styles } = useChatStyles(createStyles);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [menuSize, setMenuSize] = useState({ width: Math.min(320, windowWidth - 24), height: 360 });
  const [reactionsExpanded, setReactionsExpanded] = useState(false);
  const visibleReactions = reactionsExpanded
    ? ALL_MESSAGE_MENU_REACTIONS
    : MESSAGE_MENU_REACTIONS.slice(0, COLLAPSED_REACTION_COUNT);

  useEffect(() => {
    setReactionsExpanded(false);
  }, [message?.id]);

  const isAvailable = Boolean(message && !message.is_deleted && !message.local_status);
  const canEdit = Boolean(
    isAvailable
    && isOwn
    && (message?.kind || 'text') === 'text'
    && message?.body_text,
  );
  const canDelete = Boolean(isAvailable && isOwn && message?.kind !== 'system');
  const canReply = Boolean(isAvailable && message?.kind !== 'system');
  const padding = Math.max(12, initialWindowMetrics?.insets.top || 0, initialWindowMetrics?.insets.bottom || 0);
  const position = placeMessageActionMenu({
    anchor,
    viewport: { width: windowWidth, height: windowHeight },
    menu: menuSize,
    align: isOwn ? 'end' : 'start',
    padding,
  });

  const close = () => {
    setReactionsExpanded(false);
    onClose();
  };

  const run = (action: (target: ChatMessage) => void) => {
    if (!message) return;
    action(message);
    close();
  };

  if (!message) return null;

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Закрыть действия с сообщением"
      />
      <View
        style={[styles.card, { top: position.top, left: position.left, width: menuSize.width }]}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (Math.abs(height - menuSize.height) > 4) {
            setMenuSize((current) => ({ ...current, height }));
          }
        }}
      >
        <Text style={styles.title}>Действия с сообщением</Text>
        {isAvailable ? (
          <View
            style={[styles.reactionRow, reactionsExpanded && styles.reactionRowExpanded]}
            accessibilityRole="toolbar"
            accessibilityLabel="Реакции на сообщение"
          >
            {visibleReactions.map((emoji) => {
              const selected = Boolean(message?.reactions?.some(
                (reaction) => reaction.emoji === emoji && reaction.reacted_by_me,
              ));
              return (
                <Pressable
                  key={emoji}
                  onPress={() => run((target) => onReaction(target, emoji))}
                  style={({ pressed }) => [
                    styles.reactionButton,
                    reactionsExpanded && styles.reactionButtonExpanded,
                    selected && styles.reactionButtonSelected,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${selected ? 'Убрать' : 'Добавить'} реакцию ${emoji}`}
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setReactionsExpanded((current) => !current)}
              style={({ pressed }) => [
                styles.reactionExpandButton,
                reactionsExpanded && styles.reactionExpandButtonExpanded,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={reactionsExpanded ? 'Свернуть реакции' : 'Ещё реакции'}
              accessibilityState={{ expanded: reactionsExpanded }}
            >
              <Text style={styles.reactionExpandIcon}>{reactionsExpanded ? '⌃' : '⌄'}</Text>
            </Pressable>
          </View>
        ) : null}
        <ScrollView style={styles.cardScroll}>
          {canReply ? (
            <ActionButton label="Ответить" icon="↩" onPress={() => run(onReply)} />
          ) : null}
          {isAvailable && onSelect ? (
            <ActionButton label="Выбрать" icon="☑" onPress={() => run(onSelect)} />
          ) : null}
          {isAvailable && message?.body_text && onCopyText ? (
            <ActionButton label="Копировать текст" icon="⧉" onPress={() => run(onCopyText)} />
          ) : null}
          {isAvailable && onCopyLink ? (
            <ActionButton label="Копировать ссылку" icon="🔗" onPress={() => run(onCopyLink)} />
          ) : null}
          {canEdit ? (
            <ActionButton label="Редактировать" icon="✎" onPress={() => run(onEdit)} />
          ) : null}
          {isAvailable ? (
            <ActionButton label="Переслать" icon="➦" onPress={() => run(onForward)} />
          ) : null}
          {isAvailable && onPin ? (
            <ActionButton
              label={pinnedMessageId === message?.id ? 'Открепить сообщение' : 'Закрепить сообщение'}
              icon="📌"
              onPress={() => run(onPin)}
            />
          ) : null}
          {isAvailable && isOwn && onReads ? (
            <ActionButton label="Кто прочитал" icon="✓✓" onPress={() => run(onReads)} />
          ) : null}
          {isAvailable && message?.kind === 'task_share' && message.task_preview?.id && onOpenTask ? (
            <ActionButton label="Открыть задачу" icon="☑" onPress={() => run(onOpenTask)} />
          ) : null}
          {isAvailable && !isOwn && onReport ? (
            <ActionButton label="Подготовить жалобу" icon="⚑" onPress={() => run(onReport)} />
          ) : null}
          {canDelete ? (
            <ActionButton
              label="Удалить"
              icon="⌫"
              danger
              onPress={() => run(onDelete)}
            />
          ) : null}
          {!isAvailable ? (
            <Text style={styles.unavailable}>Для этого сообщения действия недоступны</Text>
          ) : null}
          <ActionButton label="Отмена" onPress={close} />
        </ScrollView>
      </View>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  danger = false,
  onPress,
}: {
  label: string;
  icon?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? <Text style={[styles.actionIcon, danger && styles.danger]}>{icon}</Text> : null}
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    elevation: 40,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  card: {
    position: 'absolute',
    maxHeight: '78%',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: chatTokens.panelBg,
  },
  cardScroll: { maxHeight: 360 },
  title: {
    marginHorizontal: 8,
    marginBottom: 10,
    color: chatTokens.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  reactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
    marginBottom: 10,
  },
  reactionRowExpanded: {
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  reactionButton: {
    flex: 1,
    minWidth: 44,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  reactionButtonExpanded: {
    flex: 0,
    width: 44,
    height: 44,
    minHeight: 44,
  },
  reactionButtonSelected: {
    borderWidth: 2,
    borderColor: chatTokens.composerActionBg,
    backgroundColor: chatTokens.sidebarRowSoftActive,
  },
  reactionEmoji: { fontSize: 24 },
  reactionExpandButton: {
    width: 44,
    height: 48,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  reactionExpandButtonExpanded: { height: 44 },
  reactionExpandIcon: { color: chatTokens.textPrimary, fontSize: 24, lineHeight: 26 },
  actionButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  actionIcon: {
    width: 24,
    color: chatTokens.textSecondary,
    fontSize: 22,
    textAlign: 'center',
  },
  actionText: { color: chatTokens.textPrimary, fontSize: 16, fontWeight: '600' },
  danger: { color: chatTokens.dangerText },
  unavailable: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    color: chatTokens.textSecondary,
    fontSize: 14,
  },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.86 },
});
