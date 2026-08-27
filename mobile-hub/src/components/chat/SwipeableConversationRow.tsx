import { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import {
  INBOX_ROW_SWIPE_TRIGGER_DP,
  inboxRowSwipeAction,
  shouldKeepHorizontalSwipe,
  shouldStartInboxRowSwipe,
} from '../../chat/chatGestures';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatConversationRow } from './ChatConversationRow';

export function SwipeableConversationRow({
  item,
  active,
  onPress,
  onLongPress,
  onMute,
  onArchive,
}: {
  item: ChatConversationSummary;
  active?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onMute?: () => void;
  onArchive?: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const offset = useRef(new Animated.Value(0)).current;

  const reset = () => {
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
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      shouldStartInboxRowSwipe(gesture.dx, gesture.dy)
    ),
    onMoveShouldSetPanResponderCapture: (_, gesture) => (
      shouldStartInboxRowSwipe(gesture.dx, gesture.dy)
    ),
    onPanResponderMove: (_, gesture) => {
      if (!reduceMotion) {
        offset.setValue(Math.max(-96, Math.min(96, gesture.dx)));
      }
    },
    onPanResponderRelease: (_, gesture) => {
      const action = inboxRowSwipeAction(gesture.dx);
      if (action === 'mute') onMute?.();
      if (action === 'archive') onArchive?.();
      reset();
    },
    onPanResponderTerminate: reset,
    onPanResponderTerminationRequest: (_, gesture) => !shouldKeepHorizontalSwipe(gesture.dx, gesture.dy),
  }), [offset, onArchive, onMute, reduceMotion]);

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
            <Text style={styles.actionText}>{item.is_muted ? 'Звук' : 'Без звука'}</Text>
          </Animated.View>
          <Animated.View style={[styles.action, styles.archive, { opacity: archiveOpacity }]} pointerEvents="none">
            <Text style={styles.actionText}>{item.is_archived ? 'Вернуть' : 'В архив'}</Text>
          </Animated.View>
        </>
      ) : null}
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX: offset }] }}>
        <ChatConversationRow
          item={item}
          active={active}
          onPress={onPress}
          onLongPress={onLongPress}
        />
      </Animated.View>
    </View>
  );
}

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
