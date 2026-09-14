import { useLayoutEffect, useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import {
  BACK_SWIPE_EDGE_DP,
  shouldEngageEdgeBackSwipe,
  shouldKeepHorizontalSwipe,
  shouldTrackEdgeBackSwipe,
  shouldTriggerEdgeBackSwipe,
} from '../../chat/chatGestures';

export function EdgeBackSwipeOverlay({
  enabled = true,
  onBack,
}: {
  enabled?: boolean;
  onBack: () => void;
}) {
  const tracking = useRef(false);
  const engaged = useRef(false);
  const scope = useMemo(() => Symbol('edge-back-gesture'), [enabled, onBack]);
  const currentScope = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    currentScope.current = enabled ? scope : null;
    tracking.current = false;
    engaged.current = false;
    return () => {
      currentScope.current = null;
      tracking.current = false;
      engaged.current = false;
    };
  }, [enabled, scope]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => {
      if (!enabled || currentScope.current !== scope) return false;
      const startX = Number.isFinite(gesture.x0) ? gesture.x0 : Number(event.nativeEvent.locationX || 0) - gesture.dx;
      return shouldTrackEdgeBackSwipe(startX) && shouldEngageEdgeBackSwipe(gesture.dx, gesture.dy);
    },
    onMoveShouldSetPanResponderCapture: (event, gesture) => {
      if (!enabled || currentScope.current !== scope) return false;
      const startX = Number.isFinite(gesture.x0) ? gesture.x0 : Number(event.nativeEvent.locationX || 0) - gesture.dx;
      return shouldTrackEdgeBackSwipe(startX) && shouldEngageEdgeBackSwipe(gesture.dx, gesture.dy);
    },
    onPanResponderGrant: () => {
      if (!enabled || currentScope.current !== scope) return;
      tracking.current = true;
      engaged.current = false;
    },
    onPanResponderMove: (_, gesture) => {
      if (!tracking.current || currentScope.current !== scope) return;
      if (shouldEngageEdgeBackSwipe(gesture.dx, gesture.dy)) engaged.current = true;
    },
    onPanResponderRelease: (_, gesture) => {
      if (currentScope.current !== scope) return;
      const shouldGoBack = enabled && tracking.current && shouldTriggerEdgeBackSwipe(gesture.dx, engaged.current);
      tracking.current = false;
      engaged.current = false;
      if (shouldGoBack) onBack();
    },
    onPanResponderTerminate: () => {
      if (currentScope.current !== scope) return;
      tracking.current = false;
      engaged.current = false;
    },
    onPanResponderTerminationRequest: (_, gesture) => (
      currentScope.current !== scope || !engaged.current || !shouldKeepHorizontalSwipe(gesture.dx, gesture.dy)
    ),
  }), [enabled, onBack, scope]);

  if (!enabled) return null;
  return (
    <View
      style={styles.edge}
      {...panResponder.panHandlers}
      pointerEvents="box-only"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  edge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: BACK_SWIPE_EDGE_DP,
    zIndex: 4,
  },
});
