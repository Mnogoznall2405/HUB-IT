import { memo, useContext, useEffect, useMemo } from 'react';
import {
  Keyboard,
  StyleSheet,
  useWindowDimensions,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Animated, { runOnJS, SlideInDown } from 'react-native-reanimated';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import {
  resolveSheetEdgeStyle,
  shouldDismissSheet,
} from './ChatBottomSheet';

/**
 * Inline bottom panel for pickers that replace the keyboard (emoji, stickers,
 * poll) — same model as ChatAttachmentPanel and Telegram: renders in the
 * normal layout flow under the composer, no separate Modal window.
 *
 * A Modal hosts a second window on Android whose IME/inset stream does not
 * reliably match KeyboardStickyView's shared values there — the sheet could
 * end up floating mid-screen. Inline rendering sidesteps that whole path.
 * The panel itself still rides the keyboard via KeyboardStickyView — edge-to-
 * edge windows are not resized by adjustResize, so sheets with inputs inside
 * (poll fields, task search, emoji search) would otherwise sink under the
 * open IME. In the main window the shared keyboard values are reliable —
 * the same component already lifts the composer.
 */
export const ChatInlineSheet = memo(function ChatInlineSheet({
  visible,
  onClose,
  dismissAccessibilityLabel = 'Закрыть',
  sheetStyle,
  contentStyle,
  children,
  sheetTestID,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  dismissAccessibilityLabel?: string;
  sheetStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  sheetTestID?: string;
}) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const keyboardState = useKeyboardState();
  const { height: windowHeight } = useWindowDimensions();

  // Panel and keyboard swap, not stack: opening the panel hides the IME
  // (same mutual exclusion as ChatAttachmentPanel).
  useEffect(() => { if (visible) Keyboard.dismiss(); }, [visible]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!reduceMotion)
    .activeOffsetY(10)
    .failOffsetX([-12, 12])
    .onEnd((event) => {
      'worklet';
      if (shouldDismissSheet(event.translationY, event.velocityY)) runOnJS(onClose)();
    }), [onClose, reduceMotion]);

  if (!visible) return null;

  // An open keyboard covers the nav bar — the inset would only leave a dead
  // strip between the panel and the keyboard (same rule as the composer).
  const insetBottom = keyboardState.isVisible ? 0 : Math.max(0, insets?.bottom || 0);
  // Percentage heights used to resolve against the full Modal window. Inline,
  // the parent is the auto-height KeyboardStickyView wrapper, so '%' has no
  // definite base — resolve it to window pixels with the same semantics.
  const flat = StyleSheet.flatten(sheetStyle);
  const toPx = (value: unknown): DimensionValue | undefined =>
    typeof value === 'string' && value.endsWith('%')
      ? (windowHeight * parseFloat(value)) / 100
      : (value as DimensionValue | undefined);
  const flatSheetStyle = flat && {
    ...flat,
    ...(flat.height !== undefined ? { height: toPx(flat.height) } : null),
    ...(flat.maxHeight !== undefined ? { maxHeight: toPx(flat.maxHeight) } : null),
    ...(flat.minHeight !== undefined ? { minHeight: toPx(flat.minHeight) } : null),
  };
  const sheetInsetStyle = resolveSheetEdgeStyle(flatSheetStyle, insetBottom);

  return (
    <KeyboardStickyView>
      <Animated.View
        testID={sheetTestID}
        entering={reduceMotion ? undefined : SlideInDown.duration(180)}
        style={[styles.panel, flatSheetStyle, sheetInsetStyle]}
        accessibilityLabel={dismissAccessibilityLabel}
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
    </KeyboardStickyView>
  );
});

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  panel: {
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
