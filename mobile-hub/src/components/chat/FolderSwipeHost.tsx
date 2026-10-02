import { createContext, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  folderSwipeDirection,
  shouldLockInboxRefresh,
  shouldStartFolderSwipe,
  shouldTriggerFolderSwipe,
} from '../../chat/chatGestures';

export type FolderSwipeGestureSync = {
  /** 1 while the current touch began inside a conversation row (CHAT-INBOX-06). */
  rowTouchActive: SharedValue<number>;
  /** 1 while an engaged folder swipe blocks row responders (`capture` mode). */
  rowsSuppressed: SharedValue<number>;
};

/** Row ↔ folder-pager coordination channel; null outside a FolderSwipeHost. */
export const FolderSwipeGestureContext = createContext<FolderSwipeGestureSync | null>(null);

export function FolderSwipeHost({
  enabled = true,
  capture = false,
  fill = true,
  onSwipeFolder,
  onSwipeEngage,
  children,
}: {
  enabled?: boolean;
  capture?: boolean;
  fill?: boolean;
  onSwipeFolder: (direction: 'prev' | 'next') => void;
  onSwipeEngage?: (engaged: boolean) => void;
  children: ReactNode;
}) {
  const onSwipeFolderRef = useRef(onSwipeFolder);
  const onSwipeEngageRef = useRef(onSwipeEngage);
  onSwipeFolderRef.current = onSwipeFolder;
  onSwipeEngageRef.current = onSwipeEngage;
  const translateX = useSharedValue(0);
  const engagedFlag = useSharedValue(0);
  // Pager commit runs a slide-out → swap → slide-in sequence; onFinalize must
  // not interrupt it with its spring-back (that was the "big bounce" bug).
  const committedFlag = useSharedValue(0);
  const originX = useSharedValue(-1);
  const originY = useSharedValue(-1);
  const reduceMotion = useReducedMotion();
  const { width: screenWidth } = useWindowDimensions();
  // JS-side origin for the refresh-lock heuristic (RN touch props run on JS).
  const jsOrigin = useRef<{ x: number; y: number } | null>(null);
  // CHAT-INBOX-06: shared touch-zone flags. Rows raise `rowTouchActive` on
  // touch-start so this pager never steals row swipes; `rowsSuppressed` is the
  // reverse edge — with `capture`, an engaged pager blocks new row responders.
  const rowTouchActive = useSharedValue(0);
  const rowsSuppressed = useSharedValue(0);
  const gestureSync = useMemo<FolderSwipeGestureSync>(
    () => ({ rowTouchActive, rowsSuppressed }),
    [rowTouchActive, rowsSuppressed],
  );

  const setEngaged = useCallback((next: boolean) => {
    onSwipeEngageRef.current?.(next);
  }, []);
  const fireSwipe = useCallback((direction: 'prev' | 'next') => {
    onSwipeFolderRef.current(direction);
  }, []);

  useEffect(() => {
    if (enabled) return;
    translateX.value = 0;
    engagedFlag.value = 0;
    rowsSuppressed.value = 0;
    onSwipeEngageRef.current?.(false);
  }, [enabled, engagedFlag, rowsSuppressed, translateX]);

  // B-T2-1: the folder swipe moved to Gesture Handler — the same UI-thread
  // stack as message/back swipes — so it no longer fights the responder lock.
  const gesture = Gesture.Pan()
    .enabled(enabled)
    .manualActivation(true)
    .onTouchesDown((event) => {
      'worklet';
      const touch = event.allTouches[0];
      if (touch) { originX.value = touch.x; originY.value = touch.y; }
    })
    .onTouchesMove((event, manager) => {
      'worklet';
      if (event.allTouches.length > 1 || originX.value < 0) { manager.fail(); return; }
      // CHAT-INBOX-06: a touch that began inside a conversation row belongs to
      // the row swipe (Telegram-style zones) — the pager must not steal it.
      if (rowTouchActive.value === 1) { manager.fail(); return; }
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.x - originX.value;
      const dy = touch.y - originY.value;
      if (shouldStartFolderSwipe(dx, dy)) {
        rowsSuppressed.value = capture ? 1 : 0;
        manager.activate();
      } else if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
        manager.fail();
      }
    })
    .onUpdate((event) => {
      'worklet';
      if (engagedFlag.value === 0) {
        engagedFlag.value = 1;
        runOnJS(setEngaged)(true);
      }
      // DEV-FOLDER-1: follow the finger 1:1 (pager style) instead of the old
      // rubber band ±56dp — the visible "wobble" came from translation*0.3.
      if (!reduceMotion) {
        translateX.value = Math.max(-screenWidth, Math.min(screenWidth, event.translationX));
      }
    })
    .onEnd((event) => {
      'worklet';
      if (!enabled) {
        engagedFlag.value = 0;
        if (reduceMotion) translateX.value = 0;
        else translateX.value = withSpring(0, { damping: 20, stiffness: 260 });
        return;
      }
      const commit = shouldTriggerFolderSwipe(event.translationX, event.velocityX)
        && shouldStartFolderSwipe(event.translationX, event.translationY);
      if (engagedFlag.value) runOnJS(setEngaged)(false);
      engagedFlag.value = 0;
      if (commit && !reduceMotion) {
        // DEV-FOLDER-1: pager transition — the current list slides out along
        // the swipe, the new folder slides in from the opposite edge without
        // the old spring-return wobble.
        committedFlag.value = 1;
        const direction = folderSwipeDirection(event.translationX);
        const out = event.translationX > 0 ? screenWidth : -screenWidth;
        translateX.value = withTiming(out, { duration: 140 }, () => {
          'worklet';
          translateX.value = -out;
          runOnJS(fireSwipe)(direction);
          translateX.value = withTiming(0, { duration: 180 }, () => {
            'worklet';
            committedFlag.value = 0;
          });
        });
        return;
      }
      if (reduceMotion) translateX.value = 0;
      else translateX.value = withSpring(0, { damping: 20, stiffness: 260 });
      if (commit) runOnJS(fireSwipe)(folderSwipeDirection(event.translationX));
    })
    .onFinalize(() => {
      'worklet';
      originX.value = -1;
      originY.value = -1;
      rowsSuppressed.value = 0;
      engagedFlag.value = 0;
      // The JS refresh-lock heuristic (onTouchMove → setEngaged) can fire even
      // when the gesture never activated (e.g. denied by a row touch), so the
      // release must be unconditional — otherwise RefreshControl stays hidden.
      runOnJS(setEngaged)(false);
      if (committedFlag.value) return; // pager commit owns translateX now
      if (translateX.value !== 0) {
        translateX.value = reduceMotion ? 0 : withSpring(0, { damping: 20, stiffness: 260 });
      }
    });

  const hostStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <FolderSwipeGestureContext.Provider value={gestureSync}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[fill ? styles.fill : undefined, hostStyle]}
          onTouchStart={(event) => {
            if (!enabled) return;
            const touch = event.nativeEvent.touches[0];
            jsOrigin.current = touch ? { x: touch.pageX, y: touch.pageY } : null;
          }}
          onTouchMove={(event) => {
            if (!enabled || !jsOrigin.current) return;
            const touch = event.nativeEvent.touches[0];
            if (!touch || event.nativeEvent.touches.length > 1) return;
            const dx = touch.pageX - jsOrigin.current.x;
            const dy = touch.pageY - jsOrigin.current.y;
            if (shouldLockInboxRefresh(dx, dy)) setEngaged(true);
          }}
          onTouchEnd={() => { jsOrigin.current = null; }}
          onTouchCancel={() => { jsOrigin.current = null; }}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </FolderSwipeGestureContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
