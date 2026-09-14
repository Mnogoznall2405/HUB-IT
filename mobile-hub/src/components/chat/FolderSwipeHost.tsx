import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  folderSwipeDirection,
  shouldKeepHorizontalSwipe,
  shouldLockInboxRefresh,
  shouldStartFolderSwipe,
  shouldTriggerFolderSwipe,
} from '../../chat/chatGestures';

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
  const engaged = useRef(false);
  const granted = useRef(false);
  const mounted = useRef(true);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const translateX = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const origin = useRef<{ x: number; y: number } | null>(null);
  const onSwipeFolderRef = useRef(onSwipeFolder);
  const onSwipeEngageRef = useRef(onSwipeEngage);
  onSwipeFolderRef.current = onSwipeFolder;
  onSwipeEngageRef.current = onSwipeEngage;

  const setEngaged = useCallback((next: boolean) => {
    if (engaged.current === next) return;
    engaged.current = next;
    onSwipeEngageRef.current?.(next);
  }, []);
  const reset = useCallback((incomingOffset?: number) => {
    granted.current = false;
    origin.current = null;
    setEngaged(false);
    translateX.stopAnimation();
    if (incomingOffset !== undefined && !reduceMotion) translateX.setValue(incomingOffset);
    if (reduceMotion) translateX.setValue(0);
    else Animated.spring(translateX, { toValue: 0, tension: 150, friction: 20, useNativeDriver: true }).start();
  }, [reduceMotion, setEngaged, translateX]);
  useEffect(() => { if (!enabled) reset(); }, [enabled, reset]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      granted.current = false;
      origin.current = null;
      setEngaged(false);
      translateX.stopAnimation();
    };
  }, [setEngaged, translateX]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => {
      const start = mounted.current && enabledRef.current && gesture.numberActiveTouches <= 1 && shouldStartFolderSwipe(gesture.dx, gesture.dy);
      if (start) setEngaged(true);
      return start;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      const start = mounted.current && enabledRef.current && capture && gesture.numberActiveTouches <= 1 && shouldStartFolderSwipe(gesture.dx, gesture.dy);
      if (start) setEngaged(true);
      return start;
    },
    onPanResponderGrant: () => {
      if (!mounted.current || !enabledRef.current) return;
      granted.current = true;
      translateX.stopAnimation();
      setEngaged(true);
    },
    onPanResponderMove: (_, gesture) => {
      if (!enabledRef.current || gesture.numberActiveTouches > 1) { reset(); return; }
      if (!reduceMotion && granted.current) translateX.setValue(Math.max(-56, Math.min(56, gesture.dx * 0.3)));
    },
    onPanResponderRelease: (_, gesture) => {
      if (!mounted.current) return;
      const commit = mounted.current && enabledRef.current && granted.current
        && shouldTriggerFolderSwipe(gesture.dx, gesture.vx) && shouldStartFolderSwipe(gesture.dx, gesture.dy);
      reset(commit ? (gesture.dx < 0 ? 24 : -24) : undefined);
      if (commit) {
        onSwipeFolderRef.current(folderSwipeDirection(gesture.dx));
      }
    },
    onPanResponderTerminate: () => {
      reset();
    },
    onPanResponderTerminationRequest: (_, gesture) => (
      !engaged.current || !shouldKeepHorizontalSwipe(gesture.dx, gesture.dy)
    ),
  }), [capture, reduceMotion, reset, setEngaged, translateX]);

  return (
    <Animated.View
      style={[fill ? styles.fill : undefined, { transform: [{ translateX }] }]}
      {...(enabled ? panResponder.panHandlers : undefined)}
      onTouchStart={(event) => {
        if (!enabled) return;
        const touch = event.nativeEvent.touches[0];
        origin.current = touch ? { x: touch.pageX, y: touch.pageY } : null;
      }}
      onTouchMove={(event) => {
        if (!enabled || !origin.current) return;
        if (event.nativeEvent.touches.length > 1) { reset(); return; }
        const touch = event.nativeEvent.touches[0];
        if (!touch) return;
        const dx = touch.pageX - origin.current.x;
        const dy = touch.pageY - origin.current.y;
        if (!granted.current) setEngaged(shouldLockInboxRefresh(dx, dy));
      }}
      onTouchEnd={() => {
        origin.current = null;
        setEngaged(false);
      }}
      onTouchCancel={() => {
        reset();
      }}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
