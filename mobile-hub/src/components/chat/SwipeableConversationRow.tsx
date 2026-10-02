import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import {
  INBOX_ROW_SWIPE_TRIGGER_DP,
  inboxRowSwipeAction,
  shouldKeepHorizontalSwipe,
  shouldStartInboxRowSwipe,
  type InboxRowSwipeAction,
} from '../../chat/chatGestures';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatConversationRow } from './ChatConversationRow';
import { FolderSwipeGestureContext } from './FolderSwipeHost';

export const SwipeableConversationRow = memo(function SwipeableConversationRow({
  item,
  active,
  onPress,
  onLongPress,
  onMute,
  onArchive,
  onRead,
  onPin,
  typingText,
  draftText,
}: {
  item: ChatConversationSummary;
  active?: boolean;
  typingText?: string;
  draftText?: string;
  onPress: (item: ChatConversationSummary) => void;
  onLongPress?: (item: ChatConversationSummary) => void;
  onMute?: (item: ChatConversationSummary) => void;
  onArchive?: (item: ChatConversationSummary) => void;
  onRead?: (item: ChatConversationSummary) => void;
  onPin?: (item: ChatConversationSummary) => void;
}) {
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const offset = useRef(new Animated.Value(0)).current;

  const reset = useCallback(() => {
    if (reduceMotion) {
      offset.setValue(0);
      return;
    }
    Animated.spring(offset, {
      toValue: 0,
      useNativeDriver: true,
      speed: 28,
      bounciness: 4,
    }).start();
  }, [offset, reduceMotion]);

  const handlePress = useCallback(() => onPress(item), [item, onPress]);
  const handleLongPress = useCallback(() => onLongPress?.(item), [item, onLongPress]);
  const handleMute = useCallback(() => onMute?.(item), [item, onMute]);
  const handleArchive = useCallback(() => onArchive?.(item), [item, onArchive]);
  const handleRead = useCallback(() => onRead?.(item), [item, onRead]);
  const handlePin = useCallback(() => onPin?.(item), [item, onPin]);
  const hasUnread = Number(item.unread_count || 0) > 0;
  // Mark-as-unread does not exist server-side: the deep-right zone degrades
  // to the mute action instead of promising a no-op (R-SWIPE-1).
  const resolveAction = useCallback((dx: number): InboxRowSwipeAction | null => {
    const action = inboxRowSwipeAction(dx);
    if (action === 'read' && !hasUnread) return 'mute';
    return action;
  }, [hasUnread]);
  const [swipeAction, setSwipeAction] = useState<InboxRowSwipeAction | null>(null);
  // CHAT-INBOX-06: while this row hosts the current touch the folder pager must
  // not activate; an engaged pager in `capture` mode suppresses new row swipes.
  const folderSwipe = useContext(FolderSwipeGestureContext);
  useEffect(() => () => {
    if (folderSwipe) folderSwipe.rowTouchActive.value = 0;
  }, [folderSwipe]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      folderSwipe?.rowsSuppressed.value !== 1
      && shouldStartInboxRowSwipe(gesture.dx, gesture.dy)
    ),
    onMoveShouldSetPanResponderCapture: (_, gesture) => (
      folderSwipe?.rowsSuppressed.value !== 1
      && shouldStartInboxRowSwipe(gesture.dx, gesture.dy)
    ),
    onPanResponderMove: (_, gesture) => {
      if (!reduceMotion) {
        offset.setValue(Math.max(-176, Math.min(176, gesture.dx)));
      }
      setSwipeAction((prev) => {
        const next = resolveAction(gesture.dx);
        return prev === next ? prev : next;
      });
    },
    onPanResponderRelease: (_, gesture) => {
      const action = resolveAction(gesture.dx);
      if (action === 'mute') handleMute();
      if (action === 'read') handleRead();
      if (action === 'archive') handleArchive();
      if (action === 'pin') handlePin();
      setSwipeAction(null);
      reset();
    },
    onPanResponderTerminate: () => {
      setSwipeAction(null);
      reset();
    },
    onPanResponderTerminationRequest: (_, gesture) => !shouldKeepHorizontalSwipe(gesture.dx, gesture.dy),
  }), [folderSwipe, handleArchive, handleMute, handlePin, handleRead, offset, reduceMotion, reset, resolveAction]);

  const muteOpacity = offset.interpolate({
    inputRange: [0, INBOX_ROW_SWIPE_TRIGGER_DP],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const archiveOpacity = offset.interpolate({
    inputRange: [-INBOX_ROW_SWIPE_TRIGGER_DP, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.wrap}>
      {!reduceMotion ? (
        <>
          <Animated.View style={[styles.action, styles.mute, { opacity: muteOpacity }]} pointerEvents="none">
            <Text style={styles.actionText}>
              {swipeAction === 'read'
                ? 'Прочитано'
                : (item.is_muted ? 'Звук' : 'Без звука')}
            </Text>
          </Animated.View>
          <Animated.View style={[styles.action, styles.archive, { opacity: archiveOpacity }]} pointerEvents="none">
            <Text style={styles.actionText}>
              {swipeAction === 'pin'
                ? (item.is_pinned ? 'Открепить' : 'Закрепить')
                : (item.is_archived ? 'Вернуть' : 'В архив')}
            </Text>
          </Animated.View>
        </>
      ) : null}
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX: offset }] }}
        onTouchStart={() => {
          if (folderSwipe) folderSwipe.rowTouchActive.value = 1;
        }}
        onTouchEnd={() => {
          if (folderSwipe) folderSwipe.rowTouchActive.value = 0;
        }}
        onTouchCancel={() => {
          if (folderSwipe) folderSwipe.rowTouchActive.value = 0;
        }}
      >
        <ChatConversationRow
          item={item}
          active={active}
          onPress={handlePress}
          onLongPress={handleLongPress}
          typingText={typingText}
          draftText={draftText}
        />
      </Animated.View>
    </View>
  );
});

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: { position: 'relative', overflow: 'hidden' },
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    minWidth: 88,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  mute: { left: 0, backgroundColor: chatTokens.composerActionBg },
  archive: { right: 0, backgroundColor: chatTokens.dangerText },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
