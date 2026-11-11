import { createContext, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
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

type Side = 'prev' | 'next';

const SPRING = { damping: 20, stiffness: 260 };
const COMMIT_MS = 170;
const COMMIT_FALLBACK_MS = 500;
// Past the first/last folder the list only gives a little, like a rubber band.
const EDGE_RESISTANCE = 0.22;
const EDGE_MAX_DP = 64;

/**
 * Folder pager (Telegram style): the list follows the finger and the neighbouring
 * folder slides in beside it, so the swipe shows where it leads. On release the
 * pages finish sliding, the folder is switched, and the (identical) new list takes
 * the place of the preview without a flash.
 *
 * `renderNeighbor` draws the preview of a neighbouring folder; it is mounted only
 * while a swipe is in progress, so the idle list costs nothing extra.
 */
export function FolderSwipeHost({
  enabled = true,
  capture = false,
  fill = true,
  folderKey,
  hasPrev = true,
  hasNext = true,
  renderNeighbor,
  onSwipeFolder,
  onSwipeEngage,
  children,
}: {
  enabled?: boolean;
  capture?: boolean;
  fill?: boolean;
  /** Active folder; a change after a committed swipe ends the transition. */
  folderKey?: string;
  hasPrev?: boolean;
  hasNext?: boolean;
  renderNeighbor?: (side: Side) => ReactNode;
  onSwipeFolder: (direction: Side) => void;
  onSwipeEngage?: (engaged: boolean) => void;
  children: ReactNode;
}) {
  const onSwipeFolderRef = useRef(onSwipeFolder);
  const onSwipeEngageRef = useRef(onSwipeEngage);
  onSwipeFolderRef.current = onSwipeFolder;
  onSwipeEngageRef.current = onSwipeEngage;
  const translateX = useSharedValue(0);
  const engagedFlag = useSharedValue(0);
  // A commit owns translateX until the new folder is on screen; onFinalize must
  // not interrupt it with a spring-back (that was the "big bounce" bug).
  const committedFlag = useSharedValue(0);
  const originX = useSharedValue(-1);
  const originY = useSharedValue(-1);
  // -1 / 0 / 1: which neighbour the finger is currently pulling in.
  const pullSide = useSharedValue(0);
  const hasPrevSV = useSharedValue(hasPrev ? 1 : 0);
  const hasNextSV = useSharedValue(hasNext ? 1 : 0);
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

  const [preview, setPreview] = useState<{ prev: boolean; next: boolean }>({ prev: false, next: false });
  const committing = useRef(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { hasPrevSV.value = hasPrev ? 1 : 0; }, [hasPrev, hasPrevSV]);
  useEffect(() => { hasNextSV.value = hasNext ? 1 : 0; }, [hasNext, hasNextSV]);

  const setEngaged = useCallback((next: boolean) => {
    onSwipeEngageRef.current?.(next);
  }, []);

  const showPreview = useCallback((side: Side) => {
    if (!renderNeighbor || reduceMotion) return;
    setPreview((current) => (current[side] ? current : { ...current, [side]: true }));
  }, [reduceMotion, renderNeighbor]);

  const hidePreview = useCallback(() => {
    setPreview((current) => (current.prev || current.next ? { prev: false, next: false } : current));
  }, []);

  const clearCommitTimer = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
  }, []);

  /** The new folder is on screen: put the pages back at rest and drop the preview. */
  const finishCommit = useCallback(() => {
    clearCommitTimer();
    committing.current = false;
    committedFlag.value = 0;
    translateX.value = 0;
    hidePreview();
  }, [clearCommitTimer, committedFlag, hidePreview, translateX]);

  const fireSwipe = useCallback((direction: Side) => {
    committing.current = true;
    onSwipeFolderRef.current(direction);
    clearCommitTimer();
    // The target folder may refuse (stale key, offline): never leave the list parked off-screen.
    commitTimer.current = setTimeout(() => {
      if (!committing.current) return;
      committing.current = false;
      committedFlag.value = 0;
      translateX.value = withSpring(0, SPRING);
      hidePreview();
    }, COMMIT_FALLBACK_MS);
  }, [clearCommitTimer, committedFlag, hidePreview, translateX]);

  const cancelCommit = useCallback(() => {
    clearCommitTimer();
    committing.current = false;
    hidePreview();
  }, [clearCommitTimer, hidePreview]);

  // The previous folder key changed after a committed swipe: the new list is rendered.
  const finishCommitRef = useRef(finishCommit);
  finishCommitRef.current = finishCommit;
  useEffect(() => {
    if (committing.current) finishCommitRef.current();
  }, [folderKey]);

  useEffect(() => () => clearCommitTimer(), [clearCommitTimer]);

  useEffect(() => {
    if (enabled) return;
    translateX.value = 0;
    engagedFlag.value = 0;
    committedFlag.value = 0;
    rowsSuppressed.value = 0;
    onSwipeEngageRef.current?.(false);
    cancelCommit();
  }, [cancelCommit, committedFlag, enabled, engagedFlag, rowsSuppressed, translateX]);

  // B-T2-1: the folder swipe lives in Gesture Handler — the same UI-thread
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
      if (committedFlag.value === 1) { manager.fail(); return; }
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
      const dx = event.translationX;
      // Finger moving right pulls the previous folder in from the left.
      const side = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const available = side > 0 ? hasPrevSV.value === 1 : side < 0 ? hasNextSV.value === 1 : true;
      if (side !== 0 && side !== pullSide.value && available) {
        pullSide.value = side;
        runOnJS(showPreview)(side > 0 ? 'prev' : 'next');
      }
      if (reduceMotion) return;
      // DEV-FOLDER-1: follow the finger 1:1 (pager style).
      translateX.value = available
        ? Math.max(-screenWidth, Math.min(screenWidth, dx))
        : Math.max(-EDGE_MAX_DP, Math.min(EDGE_MAX_DP, dx * EDGE_RESISTANCE));
    })
    .onEnd((event) => {
      'worklet';
      if (!enabled) {
        engagedFlag.value = 0;
        if (reduceMotion) translateX.value = 0;
        else translateX.value = withSpring(0, SPRING);
        return;
      }
      const available = event.translationX > 0 ? hasPrevSV.value === 1 : hasNextSV.value === 1;
      const commit = available
        && shouldTriggerFolderSwipe(event.translationX, event.velocityX)
        && shouldStartFolderSwipe(event.translationX, event.translationY);
      if (engagedFlag.value) runOnJS(setEngaged)(false);
      engagedFlag.value = 0;
      pullSide.value = 0;
      const direction = folderSwipeDirection(event.translationX);
      if (commit && !reduceMotion) {
        committedFlag.value = 1;
        const target = event.translationX > 0 ? screenWidth : -screenWidth;
        translateX.value = withTiming(
          target,
          { duration: COMMIT_MS, easing: Easing.out(Easing.cubic) },
          (finished) => {
            'worklet';
            if (finished) {
              // Stay parked on the preview until the new folder is rendered (finishCommit).
              runOnJS(fireSwipe)(direction);
            } else {
              committedFlag.value = 0;
              runOnJS(cancelCommit)();
            }
          },
        );
        return;
      }
      if (reduceMotion) {
        translateX.value = 0;
        if (commit) runOnJS(fireSwipe)(direction);
        return;
      }
      // Released short of the threshold: spring back, then drop the preview.
      translateX.value = withSpring(0, SPRING, (finished) => {
        'worklet';
        if (finished) runOnJS(hidePreview)();
      });
    })
    .onFinalize(() => {
      'worklet';
      originX.value = -1;
      originY.value = -1;
      rowsSuppressed.value = 0;
      engagedFlag.value = 0;
      pullSide.value = 0;
      // The JS refresh-lock heuristic (onTouchMove → setEngaged) can fire even
      // when the gesture never activated (e.g. denied by a row touch), so the
      // release must be unconditional — otherwise RefreshControl stays hidden.
      runOnJS(setEngaged)(false);
      if (committedFlag.value) return; // the commit owns translateX now
      if (translateX.value !== 0) {
        translateX.value = reduceMotion ? 0 : withSpring(0, SPRING, (finished) => {
          'worklet';
          if (finished) runOnJS(hidePreview)();
        });
      }
    });

  const pagesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <FolderSwipeGestureContext.Provider value={gestureSync}>
      <GestureDetector gesture={gesture}>
        <View
          style={[fill ? styles.fill : undefined, styles.clip]}
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
          <Animated.View style={[fill ? styles.fill : undefined, pagesStyle]}>
            {children}
            {renderNeighbor && preview.prev ? (
              <View
                testID="folder-swipe-preview-prev"
                style={[styles.page, { left: -screenWidth, width: screenWidth }]}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {renderNeighbor('prev')}
              </View>
            ) : null}
            {renderNeighbor && preview.next ? (
              <View
                testID="folder-swipe-preview-next"
                style={[styles.page, { left: screenWidth, width: screenWidth }]}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {renderNeighbor('next')}
              </View>
            ) : null}
          </Animated.View>
        </View>
      </GestureDetector>
    </FolderSwipeGestureContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clip: { overflow: 'hidden' },
  page: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
});
