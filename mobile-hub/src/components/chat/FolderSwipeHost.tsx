import { type ReactNode, useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
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
  const origin = useRef<{ x: number; y: number } | null>(null);
  const onSwipeFolderRef = useRef(onSwipeFolder);
  const onSwipeEngageRef = useRef(onSwipeEngage);
  onSwipeFolderRef.current = onSwipeFolder;
  onSwipeEngageRef.current = onSwipeEngage;

  const setEngaged = (next: boolean) => {
    if (engaged.current === next) return;
    engaged.current = next;
    onSwipeEngageRef.current?.(next);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => {
      const start = enabled && shouldStartFolderSwipe(gesture.dx, gesture.dy);
      if (start) setEngaged(true);
      return start;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      const start = enabled && capture && shouldStartFolderSwipe(gesture.dx, gesture.dy);
      if (start) setEngaged(true);
      return start;
    },
    onPanResponderGrant: () => {
      setEngaged(true);
    },
    onPanResponderRelease: (_, gesture) => {
      if (shouldTriggerFolderSwipe(gesture.dx) && Math.abs(gesture.dx) >= Math.abs(gesture.dy)) {
        onSwipeFolderRef.current(folderSwipeDirection(gesture.dx));
      }
      origin.current = null;
      setEngaged(false);
    },
    onPanResponderTerminate: () => {
      origin.current = null;
      setEngaged(false);
    },
    onPanResponderTerminationRequest: (_, gesture) => (
      !engaged.current || !shouldKeepHorizontalSwipe(gesture.dx, gesture.dy)
    ),
  }), [capture, enabled]);

  return (
    <View
      style={fill ? styles.fill : undefined}
      {...(enabled ? panResponder.panHandlers : undefined)}
      onTouchStart={(event) => {
        if (!enabled) return;
        const touch = event.nativeEvent.touches[0];
        origin.current = touch ? { x: touch.pageX, y: touch.pageY } : null;
      }}
      onTouchMove={(event) => {
        if (!enabled || !origin.current) return;
        const touch = event.nativeEvent.touches[0];
        if (!touch) return;
        const dx = touch.pageX - origin.current.x;
        const dy = touch.pageY - origin.current.y;
        if (shouldLockInboxRefresh(dx, dy)) setEngaged(true);
      }}
      onTouchEnd={() => {
        origin.current = null;
        setEngaged(false);
      }}
      onTouchCancel={() => {
        origin.current = null;
        setEngaged(false);
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
