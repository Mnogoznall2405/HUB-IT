import { useMemo, useRef } from 'react';
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

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => {
      if (!enabled) return false;
      const startX = Number(event.nativeEvent.locationX || gesture.moveX || 0);
      return shouldTrackEdgeBackSwipe(startX) && shouldEngageEdgeBackSwipe(gesture.dx, gesture.dy);
    },
    onMoveShouldSetPanResponderCapture: (event, gesture) => {
      if (!enabled) return false;
      const startX = Number(event.nativeEvent.locationX || gesture.moveX || 0);
      return shouldTrackEdgeBackSwipe(startX) && shouldEngageEdgeBackSwipe(gesture.dx, gesture.dy);
    },
    onPanResponderGrant: () => {
      tracking.current = true;
      engaged.current = false;
    },
    onPanResponderMove: (_, gesture) => {
      if (!tracking.current) return;
      if (shouldEngageEdgeBackSwipe(gesture.dx, gesture.dy)) engaged.current = true;
    },
    onPanResponderRelease: (_, gesture) => {
      if (shouldTriggerEdgeBackSwipe(gesture.dx, engaged.current)) onBack();
      tracking.current = false;
      engaged.current = false;
    },
    onPanResponderTerminate: () => {
      tracking.current = false;
      engaged.current = false;
    },
    onPanResponderTerminationRequest: (_, gesture) => (
      !engaged.current || !shouldKeepHorizontalSwipe(gesture.dx, gesture.dy)
    ),
  }), [enabled, onBack]);

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
