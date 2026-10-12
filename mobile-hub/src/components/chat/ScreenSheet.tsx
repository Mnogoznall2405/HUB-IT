import {
  createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode,
} from 'react';
import {
  BackHandler, Keyboard, Pressable, StyleSheet, useWindowDimensions, View,
  type DimensionValue, type StyleProp, type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Animated, { runOnJS, SlideInDown } from 'react-native-reanimated';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { useUiOpenTiming } from '../../diagnostics/uiOpenTiming';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { resolveSheetEdgeStyle, shouldDismissSheet } from './ChatBottomSheet';

/**
 * Bottom sheet drawn by a host mounted at the app root, over the whole screen
 * (tab bar included) in the MAIN window. A react-native Modal is a second
 * Android window whose size/insets do not reliably match the screen — the sheet
 * could end above the bottom edge. The main window has correct insets and
 * keyboard values (the inline panels already rely on them).
 *
 * Without a host (tests, isolated renders) the sheet renders in place as an
 * absolute-fill overlay.
 */
type HostApi = { show: (id: string, node: ReactNode) => void; hide: (id: string) => void };
const ScreenSheetHostContext = createContext<HostApi | null>(null);

export function ScreenSheetHost({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<Record<string, ReactNode>>({});
  const api = useMemo<HostApi>(() => ({
    show: (id, node) => setSheets((current) => ({ ...current, [id]: node })),
    hide: (id) => setSheets((current) => {
      if (!(id in current)) return current;
      const { [id]: _removed, ...rest } = current;
      return rest;
    }),
  }), []);
  return (
    <ScreenSheetHostContext.Provider value={api}>
      {children}
      {Object.entries(sheets).map(([id, node]) => (
        <View key={id} style={StyleSheet.absoluteFill} pointerEvents="box-none">{node}</View>
      ))}
    </ScreenSheetHostContext.Provider>
  );
}

export type ScreenSheetDismissReason = 'backdrop' | 'back' | 'gesture';

type ScreenSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Reports how the user dismissed the sheet, right before onClose (device diagnostics). */
  onDismissReason?: (reason: ScreenSheetDismissReason) => void;
  children: ReactNode;
  dismissAccessibilityLabel?: string;
  sheetStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  sheetTestID?: string;
  backdropTestID?: string;
};

export function ScreenSheet(props: ScreenSheetProps) {
  const host = useContext(ScreenSheetHostContext);
  const id = useId();
  useUiOpenTiming('screen-sheet', props.visible);
  const body = props.visible ? <ScreenSheetBody {...props} /> : null;
  // Re-published after every render so the hosted copy always shows current props.
  useEffect(() => {
    if (!host) return;
    if (body) host.show(id, body);
    else host.hide(id);
  });
  useEffect(() => () => host?.hide(id), [host, id]);
  if (host || !body) return null;
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">{body}</View>;
}

const ScreenSheetBody = memo(function ScreenSheetBody({
  onClose,
  onDismissReason,
  children,
  dismissAccessibilityLabel = 'Закрыть',
  sheetStyle,
  contentStyle,
  sheetTestID,
  backdropTestID,
}: ScreenSheetProps) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const keyboardState = useKeyboardState();
  const { height: windowHeight } = useWindowDimensions();

  const dismiss = useCallback((reason: ScreenSheetDismissReason) => {
    onDismissReason?.(reason);
    onClose();
  }, [onClose, onDismissReason]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss('back');
      return true;
    });
    return () => subscription.remove();
  }, [dismiss]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!reduceMotion)
    .activeOffsetY(10)
    .failOffsetX([-12, 12])
    .onEnd((event) => {
      'worklet';
      if (shouldDismissSheet(event.translationY, event.velocityY)) runOnJS(dismiss)('gesture');
    }), [dismiss, reduceMotion]);

  // An open keyboard covers the nav bar: the inset would only leave a dead strip.
  const insetBottom = keyboardState.isVisible ? 0 : Math.max(0, insets?.bottom || 0);
  // Percent heights resolve to window pixels (the sticky wrapper has no definite height).
  const flat = StyleSheet.flatten(sheetStyle);
  const toPx = (value: unknown): DimensionValue | undefined =>
    typeof value === 'string' && value.endsWith('%')
      ? (windowHeight * parseFloat(value)) / 100
      : (value as DimensionValue | undefined);
  const flatSheetStyle = flat && {
    ...flat,
    ...(flat.maxHeight !== undefined ? { maxHeight: toPx(flat.maxHeight) } : null),
    ...(flat.height !== undefined ? { height: toPx(flat.height) } : null),
  };

  return (
    <View style={styles.fill} pointerEvents="box-none">
      <Pressable
        testID={backdropTestID}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={() => { Keyboard.dismiss(); dismiss('backdrop'); }}
        accessibilityRole="button"
        accessibilityLabel={dismissAccessibilityLabel}
      />
      <View style={styles.bottom} pointerEvents="box-none">
        <KeyboardStickyView>
          <Animated.View
            testID={sheetTestID}
            entering={reduceMotion ? undefined : SlideInDown.duration(180)}
            style={[styles.panel, flatSheetStyle, resolveSheetEdgeStyle(flatSheetStyle, insetBottom)]}
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
        </KeyboardStickyView>
      </View>
    </View>
  );
});

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.42)' },
  bottom: { flex: 1, justifyContent: 'flex-end' },
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
  handle: { width: 36, height: 4, borderRadius: 2, opacity: 0.5 },
});
