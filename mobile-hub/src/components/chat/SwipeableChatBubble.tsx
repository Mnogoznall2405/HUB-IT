import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, useCallback, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { isChatVoiceSurfaceLocked } from '../../chat/chatVoice';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatBubble } from './ChatBubble';

export const REPLY_THRESHOLD = 44;
const MAX_OFFSET = 60;
// Rubber-band resistance past MAX_OFFSET: dx beyond the cap contributes 1/4
// of its excess, hard-capped so the bubble cannot travel far.
const OVERDRAG_FACTOR = 0.25;
const OVERDRAG_MAX = 14;

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
  'worklet';
  return dx >= REPLY_THRESHOLD;
}

export function shouldTriggerForward(dx: number): boolean {
  'worklet';
  return dx <= -REPLY_THRESHOLD;
}

export function applySwipeResistance(dx: number, minimum: number, maximum: number): number {
  'worklet';
  if (dx < minimum) return Math.max(minimum - OVERDRAG_MAX, minimum + (dx - minimum) * OVERDRAG_FACTOR);
  if (dx > maximum) return Math.min(maximum + OVERDRAG_MAX, maximum + (dx - maximum) * OVERDRAG_FACTOR);
  return dx;
}

// Which action a release with this dx resolves to: 'reply' | 'forward' | null.
export function resolveSwipeRelease(
  dx: number,
  options: { canReply: boolean; canForward: boolean },
): 'reply' | 'forward' | null {
  'worklet';
  if (options.canReply && shouldTriggerReply(dx)) return 'reply';
  if (options.canForward && shouldTriggerForward(dx)) return 'forward';
  return null;
}

const SPRING_CONFIG = { damping: 24, stiffness: 400, mass: 0.6 };

function fireHaptic() {
  void Haptics.selectionAsync().catch(() => undefined);
}

// JS-side release: the voice-surface lock lives in JS state, so the trigger
// guard runs here (the worklet cannot read it mid-gesture).
export function fireSwipe(
  side: 'reply' | 'forward',
  onSwipeReply?: () => void,
  onSwipeForward?: () => void,
) {
  if (isChatVoiceSurfaceLocked()) return;
  if (side === 'reply') onSwipeReply?.();
  else onSwipeForward?.();
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
  const offset = useSharedValue(0);
  const thresholdSide = useSharedValue(0); // -1 forward, 0 none, 1 reply
  const canReply = Boolean(onSwipeReply);
  const canForward = Boolean(onSwipeForward);
  const enabled = swipeEnabled;
  // Callbacks live in JS and may change between renders; the worklet must not
  // capture them. A stable runOnJS target reads the latest props via ref.
  const callbacksRef = useRef({ onSwipeReply, onSwipeForward });
  callbacksRef.current = { onSwipeReply, onSwipeForward };
  const handleRelease = useCallback((side: 'reply' | 'forward') => {
    fireSwipe(side, callbacksRef.current.onSwipeReply, callbacksRef.current.onSwipeForward);
  }, []);
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    // Deliberate horizontal start only; vertical scroll must always win.
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onUpdate((event) => {
      const minimum = canForward ? -MAX_OFFSET : 0;
      const maximum = canReply ? MAX_OFFSET : 0;
      offset.value = applySwipeResistance(event.translationX, minimum, maximum);
      const side = event.translationX >= REPLY_THRESHOLD && canReply
        ? 1
        : event.translationX <= -REPLY_THRESHOLD && canForward
          ? -1
          : 0;
      if (side !== 0 && side !== thresholdSide.value) {
        thresholdSide.value = side;
        runOnJS(fireHaptic)();
      } else if (side === 0) {
        thresholdSide.value = 0;
      }
    })
    .onEnd((event) => {
      const side = resolveSwipeRelease(event.translationX, { canReply, canForward });
      offset.value = reduceMotion ? 0 : withSpring(0, SPRING_CONFIG);
      thresholdSide.value = 0;
      if (side) runOnJS(handleRelease)(side);
    })
    .onFinalize(() => {
      if (offset.value !== 0) offset.value = reduceMotion ? 0 : withSpring(0, SPRING_CONFIG);
      thresholdSide.value = 0;
    }), [canForward, canReply, enabled, handleRelease, offset, reduceMotion, thresholdSide]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));
  const replyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [0, REPLY_THRESHOLD], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(offset.value, [0, REPLY_THRESHOLD], [0.5, 1], 'clamp') }],
  }));
  const forwardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [-REPLY_THRESHOLD, 0], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(offset.value, [-REPLY_THRESHOLD, 0], [1, 0.5], 'clamp') }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.container}>
        {canReply ? (
          <Animated.View style={[styles.indicator, styles.replyIndicator, replyStyle]} pointerEvents="none">
            <MaterialCommunityIcons name="reply" size={22} color="#fff" />
          </Animated.View>
        ) : null}
        {canForward ? (
          <Animated.View style={[styles.indicator, styles.forwardIndicator, forwardStyle]} pointerEvents="none">
            <MaterialCommunityIcons name="share" size={22} color="#fff" />
          </Animated.View>
        ) : null}
        <Animated.View style={bubbleStyle}>
          <ChatBubble {...bubbleProps} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
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
});
