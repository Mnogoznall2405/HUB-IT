import { memo, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { shouldKeepHorizontalSwipe } from '../../chat/chatGestures';
import { isChatVoiceSurfaceLocked } from '../../chat/chatVoice';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatBubble } from './ChatBubble';

const REPLY_THRESHOLD = 44;
const MAX_OFFSET = 60;

export function shouldStartReplySwipe(dx: number, dy: number): boolean {
  return dx > 8 && Math.abs(dx) > Math.abs(dy) * 1.4;
}

export function shouldStartMessageSwipe(
  dx: number,
  dy: number,
  options: { canReply: boolean; canForward: boolean },
): boolean {
  if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy) * 1.4) return false;
  return dx > 0 ? options.canReply : options.canForward;
}

export function shouldTriggerReply(dx: number): boolean {
  return dx >= REPLY_THRESHOLD;
}

export function shouldTriggerForward(dx: number): boolean {
  return dx <= -REPLY_THRESHOLD;
}

export const SwipeableChatBubble = memo(function SwipeableChatBubble({
  onSwipeReply,
  onSwipeForward,
  swipeEnabled = true,
  ...bubbleProps
}: React.ComponentProps<typeof ChatBubble> & {
  onSwipeReply?: () => void;
  onSwipeForward?: () => void;
  swipeEnabled?: boolean;
}) {
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const offset = useRef(new Animated.Value(0)).current;
  const thresholdDirection = useRef<'reply' | 'forward' | null>(null);

  const reset = () => {
    thresholdDirection.current = null;
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

  const startSwipe = (dx: number, dy: number) => Boolean(
    swipeEnabled
    && !isChatVoiceSurfaceLocked()
    && shouldStartMessageSwipe(dx, dy, {
      canReply: Boolean(onSwipeReply),
      canForward: Boolean(onSwipeForward),
    }),
  );

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => startSwipe(gesture.dx, gesture.dy),
    onMoveShouldSetPanResponderCapture: (_, gesture) => startSwipe(gesture.dx, gesture.dy),
    onPanResponderTerminationRequest: (_, gesture) => !shouldKeepHorizontalSwipe(gesture.dx, gesture.dy),
    onPanResponderMove: (_, gesture) => {
      const minimum = onSwipeForward ? -MAX_OFFSET : 0;
      const maximum = onSwipeReply ? MAX_OFFSET : 0;
      const nextOffset = Math.max(minimum, Math.min(maximum, gesture.dx));
      if (!reduceMotion) offset.setValue(nextOffset);
      const nextDirection = shouldTriggerReply(gesture.dx) && onSwipeReply
        ? 'reply'
        : shouldTriggerForward(gesture.dx) && onSwipeForward
          ? 'forward'
          : null;
      if (nextDirection && thresholdDirection.current !== nextDirection) {
        thresholdDirection.current = nextDirection;
        void Haptics.selectionAsync().catch(() => undefined);
      }
      if (
        thresholdDirection.current === 'reply'
        && gesture.dx < REPLY_THRESHOLD - 8
      ) {
        thresholdDirection.current = null;
      }
      if (
        thresholdDirection.current === 'forward'
        && gesture.dx > -REPLY_THRESHOLD + 8
      ) {
        thresholdDirection.current = null;
      }
    },
    onPanResponderRelease: (_, gesture) => {
      if (onSwipeReply && shouldTriggerReply(gesture.dx)) onSwipeReply();
      else if (onSwipeForward && shouldTriggerForward(gesture.dx)) onSwipeForward();
      reset();
    },
    onPanResponderTerminate: reset,
  }), [offset, onSwipeForward, onSwipeReply, reduceMotion, swipeEnabled]);

  const replyIndicatorOpacity = offset.interpolate({
    inputRange: [0, REPLY_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const forwardIndicatorOpacity = offset.interpolate({
    inputRange: [-REPLY_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      {!reduceMotion && onSwipeReply ? (
        <Animated.View style={[styles.indicator, styles.replyIndicator, { opacity: replyIndicatorOpacity }]} pointerEvents="none">
          <Text style={styles.indicatorText}>↩</Text>
        </Animated.View>
      ) : null}
      {!reduceMotion && onSwipeForward ? (
        <Animated.View style={[styles.indicator, styles.forwardIndicator, { opacity: forwardIndicatorOpacity }]} pointerEvents="none">
          <Text style={styles.indicatorText}>➦</Text>
        </Animated.View>
      ) : null}
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX: offset }] }}
      >
        <ChatBubble {...bubbleProps} />
      </Animated.View>
    </View>
  );
});

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  container: { position: 'relative' },
  indicator: {
    position: 'absolute',
    top: '50%',
    width: 34,
    height: 34,
    marginTop: -17,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: chatTokens.composerActionBg,
  },
  replyIndicator: { left: 6 },
  forwardIndicator: { right: 6 },
  indicatorText: { color: chatTokens.composerActionText, fontSize: 20, fontWeight: '700' },
});
