import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import type { ChatMessage } from '../../api/types';
import {
  isUsableChatMenuAnchor,
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
  onRetry?: (message: ChatMessage) => void;
  onDiscardPending?: (message: ChatMessage) => void;
  pinnedMessageId?: string | null;
  anchor?: ChatMenuAnchor | null;
  renderBubble?: (message: ChatMessage) => ReactNode;
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
  onRetry,
  onDiscardPending,
  pinnedMessageId,
  anchor = null,
  renderBubble,
}: Props) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const overlayRef = useRef<View>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: windowWidth, height: windowHeight });
  useEffect(() => {
    if (!message || reduceMotion) { opacity.setValue(1); return; }
    opacity.setValue(0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [message?.id, opacity, reduceMotion]);
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
  const padding = Math.max(12, insets?.top || 0, insets?.bottom || 0);
  const availableHeight = Math.max(48, viewport.height - padding * 2);
  const menuWidth = Math.min(320, Math.max(48, viewport.width - padding * 2));
  const position = placeMessageActionMenu({
    anchor: anchor ? { ...anchor, x: anchor.x - viewport.x, y: anchor.y - viewport.y } : null,
    viewport,
    menu: { width: menuWidth, height: Math.min(menuSize.height, availableHeight) },
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
    <View testID="chat-message-actions-viewport" ref={overlayRef} style={styles.overlay} accessibilityViewIsModal onLayout={(event) => {
      const { width, height } = event.nativeEvent.layout;
      setViewport((current) => ({ ...current, width, height }));
      overlayRef.current?.measureInWindow((x, y) => setViewport((current) => ({ ...current, x, y })));
    }}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Закрыть действия с сообщением"
      />
      {renderBubble && anchor && isUsableChatMenuAnchor(anchor) && message ? (
        <Animated.View
          testID="chat-message-actions-lifted-bubble"
          pointerEvents="none"
          style={[styles.liftedBubble, {
            top: Math.max(0, anchor.y - viewport.y),
            left: Math.max(0, anchor.x - viewport.x),
            width: Math.max(1, anchor.width),
            opacity,
            transform: [{ scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] }) }],
          }]}
        >
          {renderBubble(message)}
        </Animated.View>
      ) : null}
      <Animated.View
        testID="chat-message-actions-card"
        style={[styles.card, { top: position.top, left: position.left, width: menuWidth, maxHeight: availableHeight, opacity, transform: [{ scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (Math.abs(height - menuSize.height) > 4) {
            setMenuSize((current) => ({ ...current, height }));
          }
        }}
      >
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
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
              <MaterialCommunityIcons
                name={reactionsExpanded ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={chatTokens.textPrimary}
              />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.cardScroll}>
          {message.local_status && onRetry ? (
            <ActionButton label="Повторить" icon="refresh" onPress={() => run(onRetry)} />
          ) : null}
          {message.local_status && message.local_status !== 'sending' && onDiscardPending ? (
            <ActionButton
              label={onRetry ? 'Удалить' : 'Убрать из очереди'}
              icon="delete-outline"
              danger
              onPress={() => run(onDiscardPending)}
            />
          ) : null}
          {canReply ? (
            <ActionButton label="Ответить" icon="reply-outline" onPress={() => run(onReply)} />
          ) : null}
          {isAvailable && onSelect ? (
            <ActionButton label="Выбрать" icon="check-circle-outline" onPress={() => run(onSelect)} />
          ) : null}
          {isAvailable && message?.body_text && onCopyText ? (
            <ActionButton label="Копировать текст" icon="content-copy" onPress={() => run(onCopyText)} />
          ) : null}
          {isAvailable && onCopyLink ? (
            <ActionButton label="Копировать ссылку" icon="link-variant" onPress={() => run(onCopyLink)} />
          ) : null}
          {canEdit ? (
            <ActionButton label="Редактировать" icon="pencil-outline" onPress={() => run(onEdit)} />
          ) : null}
          {isAvailable ? (
            <ActionButton label="Переслать" icon="share-outline" onPress={() => run(onForward)} />
          ) : null}
          {isAvailable && onPin ? (
            <ActionButton
              label={pinnedMessageId === message?.id ? 'Открепить сообщение' : 'Закрепить сообщение'}
              icon="pin-outline"
              onPress={() => run(onPin)}
            />
          ) : null}
          {isAvailable && isOwn && onReads ? (
            <ActionButton label="Кто прочитал" icon="check-all" onPress={() => run(onReads)} />
          ) : null}
          {isAvailable && message?.kind === 'task_share' && message.task_preview?.id && onOpenTask ? (
            <ActionButton label="Открыть задачу" icon="clipboard-check-outline" onPress={() => run(onOpenTask)} />
          ) : null}
          {isAvailable && !isOwn && onReport ? (
            <ActionButton label="Подготовить жалобу" icon="flag-outline" onPress={() => run(onReport)} />
          ) : null}
          {canDelete ? (
            <ActionButton
              label="Удалить"
              icon="delete-outline"
              danger
              onPress={() => run(onDelete)}
            />
          ) : null}
          {!isAvailable && !message.local_status ? (
            <Text style={styles.unavailable}>Для этого сообщения действия недоступны</Text>
          ) : null}
          <ActionButton label="Отмена" onPress={close} />
        </View>
        </ScrollView>
      </Animated.View>
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
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  danger?: boolean;
  onPress: () => void;
}) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={22}
          color={danger ? chatTokens.dangerText : chatTokens.textSecondary}
        />
      ) : null}
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
  liftedBubble: {
    position: 'absolute',
    zIndex: 41,
    elevation: 41,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  card: {
    position: 'absolute',
    zIndex: 42,
    elevation: 42,
    maxHeight: '78%',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: chatTokens.panelBg,
  },
  cardScroll: {},
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
  actionButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
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
