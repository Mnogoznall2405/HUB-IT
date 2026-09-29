import { memo, useContext, useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export const SHEET_DISMISS_TRIGGER_DP = 90;
export const SHEET_DISMISS_VELOCITY = 0.7; // px/ms

export function shouldDismissSheet(dy: number, velocityY: number): boolean {
  'worklet';
  return dy >= SHEET_DISMISS_TRIGGER_DP
    || (dy >= 32 && velocityY >= SHEET_DISMISS_VELOCITY);
}

/**
 * Merge — never overwrite — the safe-area inset with consumer paddings/margins
 * from sheetStyle: edge-anchored sheets pad their content up to the inset,
 * while floating "card" sheets (bottom margin + full rounding) lift via margin
 * so the card body clears the bar entirely.
 */
export function resolveSheetEdgeStyle(
  flatSheetStyle: ViewStyle | undefined,
  insetBottom: number,
): ViewStyle {
  const numericValue = (value: unknown) => (typeof value === 'number' ? value : 0);
  const isFloatingCard = flatSheetStyle?.marginBottom != null
    || flatSheetStyle?.marginVertical != null
    || flatSheetStyle?.margin != null;
  return isFloatingCard
    ? {
      marginBottom: Math.max(
        insetBottom,
        numericValue(flatSheetStyle?.marginBottom),
        numericValue(flatSheetStyle?.marginVertical),
        numericValue(flatSheetStyle?.margin),
      ),
    }
    : {
      paddingBottom: Math.max(
        insetBottom,
        numericValue(flatSheetStyle?.paddingBottom),
        numericValue(flatSheetStyle?.padding),
      ),
    };
}

/**
 * Shared chat bottom sheet: dimmed backdrop (tap closes), sheet pinned to the
 * bottom edge, drag handle strip at the top with a UI-thread Pan —
 * pull down past the trigger (or fast fling) slides the sheet away and calls
 * onClose. Android back → onRequestClose closes the sheet, not the screen.
 */
export const ChatBottomSheet = memo(function ChatBottomSheet({
  visible,
  onClose,
  children,
  dismissAccessibilityLabel = 'Закрыть',
  sheetStyle,
  contentStyle,
  avoidKeyboard = false,
  backdropTestID,
  sheetTestID,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  dismissAccessibilityLabel?: string;
  sheetStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Wrap the sheet in a keyboard-avoiding host (sheets with text input). */
  avoidKeyboard?: boolean;
  backdropTestID?: string;
  sheetTestID?: string;
}) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const dragY = useSharedValue(0);
  // Closing by backdrop/back leaves dragY mid-flight — reset for the next open.
  useEffect(() => { if (!visible) dragY.value = 0; }, [dragY, visible]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!reduceMotion)
    .activeOffsetY(10)
    .failOffsetX([-12, 12])
    .onUpdate((event) => {
      dragY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (!shouldDismissSheet(event.translationY, event.velocityY)) {
        dragY.value = withSpring(0, { damping: 28, stiffness: 340, mass: 0.6 });
        return;
      }
      dragY.value = withTiming(600, { duration: 160 }, (finished) => {
        if (finished) runOnJS(onClose)();
        dragY.value = 0;
      });
    })
    .onFinalize(() => {
      if (dragY.value > 0 && dragY.value < 600) {
        dragY.value = withSpring(0, { damping: 28, stiffness: 340, mass: 0.6 });
      }
    }), [dragY, onClose, reduceMotion]);

  const sheetMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));
  const backdropMotion = useAnimatedStyle(() => ({
    opacity: Math.max(0.15, 1 - dragY.value / 420),
  }));

  // The sheet bottom must clear the system navigation bar (transparent
  // edge-to-edge bar draws over it otherwise).
  const flatSheetStyle = StyleSheet.flatten(sheetStyle);
  // A keyboard-aware sheet rides above the keyboard via KeyboardStickyView —
  // the nav bar is covered by the keyboard then, and the inset only leaves a
  // dead strip between the content and the keyboard.
  const keyboardState = useKeyboardState();
  const insetBottom = avoidKeyboard && keyboardState.isVisible
    ? 0
    : Math.max(0, insets?.bottom || 0);
  const sheetInsetStyle = resolveSheetEdgeStyle(flatSheetStyle, insetBottom);

  const body = (
    <View style={styles.backdrop}>
        <Animated.View style={[styles.backdropFill, backdropMotion]}>
          <Pressable
            testID={backdropTestID}
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={dismissAccessibilityLabel}
          />
        </Animated.View>
        {(() => {
          // The sheet rides the keyboard via KeyboardStickyView so the modal
          // body (backdrop included) never shrinks — a shrinking KAV left the
          // sheet floating mid-screen with the chat visible underneath.
          const sheet = (
            <Animated.View
              testID={sheetTestID}
              style={[styles.sheet, sheetStyle, sheetInsetStyle, sheetMotion]}
              accessibilityViewIsModal
            >
              <GestureDetector gesture={gesture}>
                <View
                  style={styles.handleZone}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <View style={[styles.handle, { backgroundColor: chatTokens.textSecondary }]} />
                </View>
              </GestureDetector>
              <View style={contentStyle}>{children}</View>
            </Animated.View>
          );
          // enabled-guard: a stale keyboard height (the dialog window may
          // deliver insets differently) must not leave the sheet floating
          // mid-screen while the keyboard is closed.
          return avoidKeyboard ? (
            <KeyboardStickyView enabled={keyboardState.isVisible}>{sheet}</KeyboardStickyView>
          ) : sheet;
        })()}
      </View>
  );

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Modal is a separate native view hierarchy on Android: RNGH gestures
          need their own GestureHandlerRootView inside it. */}
      <GestureHandlerRootView style={styles.root}>
        {body}
      </GestureHandlerRootView>
    </Modal>
  );
});

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: chatTokens.panelBg,
    overflow: 'hidden',
  },
  handleZone: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 2,
    minHeight: 28,
    justifyContent: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
});
