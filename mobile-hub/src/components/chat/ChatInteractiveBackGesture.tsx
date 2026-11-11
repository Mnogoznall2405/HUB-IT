import { memo, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  BACK_SWIPE_START_DP,
  shouldEngageEdgeBackSwipe,
} from '../../chat/chatGestures';

export const BACK_GESTURE_TRIGGER_RATIO = 0.35;
export const BACK_GESTURE_VELOCITY = 0.5; // px/ms

export function shouldCommitBackGesture(
  dx: number,
  velocityX: number,
  width: number,
): boolean {
  'worklet';
  return dx >= width * BACK_GESTURE_TRIGGER_RATIO
    || (dx >= 28 && velocityX >= BACK_GESTURE_VELOCITY);
}

/**
 * Interactive drag-to-go-back: wraps the whole thread screen. The Pan uses
 * manual activation so a reply-swipe starting on a bubble (dx>8) wins first,
 * and this gesture only engages for horizontal drags started in the left half
 * of the screen. On commit the content slides off and `onBack` runs after the
 * slide-out finishes so the stack pop never flickers.
 */
export const ChatInteractiveBackGesture = memo(function ChatInteractiveBackGesture({
  enabled = true,
  onBack,
  children,
}: {
  enabled?: boolean;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const dragX = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .manualActivation(true)
    .onTouchesDown((event) => {
      const touch = event.allTouches[0];
      if (touch) { startX.value = touch.x; startY.value = touch.y; }
    })
    .onTouchesMove((event, manager) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      // Only the left half: right-side right-drags belong to reply swipes.
      if (startX.value > width / 2) { manager.fail(); return; }
      const dx = touch.x - startX.value;
      const dy = touch.y - startY.value;
      if (dx >= BACK_SWIPE_START_DP && shouldEngageEdgeBackSwipe(dx, dy)) {
        manager.activate();
      } else if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
        manager.fail();
      }
    })
    .onUpdate((event) => {
      dragX.value = Math.max(0, event.translationX);
    })
    .onEnd((event) => {
      if (!shouldCommitBackGesture(event.translationX, event.velocityX, width)) {
        dragX.value = reduceMotion ? 0 : withSpring(0, { damping: 26, stiffness: 320, mass: 0.7 });
        return;
      }
      if (reduceMotion) {
        dragX.value = width;
        runOnJS(onBack)();
        return;
      }
      dragX.value = withTiming(width, { duration: 130 }, (finished) => {
        if (finished) runOnJS(onBack)();
      });
    })
    .onFinalize(() => {
      // Cancelled/failed gestures snap back without triggering back.
      if (dragX.value > 0 && dragX.value < width) {
        dragX.value = reduceMotion ? 0 : withSpring(0, { damping: 26, stiffness: 320, mass: 0.7 });
      }
    }), [dragX, enabled, onBack, reduceMotion, startX, startY, width]);

  const screenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.container, screenStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
});
