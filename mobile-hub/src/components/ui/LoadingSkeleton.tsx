import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import type { FluentTokens } from '../../theme/fluentTokens';

/** Rows past this index appear at once: a long list must not animate for seconds,
 * and rows scrolled into view later must not fade in again. */
const MAX_ANIMATED_ROWS = 10;
const ROW_STAGGER_MS = 35;

/** A list row that fades in and rises slightly when the list is first filled — rows
 * loaded from 1С arrive late and must not pop in abruptly. */
export function FadeInRow({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion || index >= MAX_ANIMATED_ROWS) return <View style={style}>{children}</View>;
  return (
    <Animated.View
      entering={FadeInDown.duration(220).delay(index * ROW_STAGGER_MS)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

function SkeletonCard({ tokens, reduceMotion }: { tokens: FluentTokens; reduceMotion: boolean }) {
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    if (reduceMotion) return undefined;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.55, { duration: 650, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    return () => { pulse.value = 0.55; };
  }, [pulse, reduceMotion]);
  const motion = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const bar = { backgroundColor: tokens.borderSoft };
  return (
    <Animated.View
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }, motion]}
    >
      <View style={[styles.bar, styles.barTitle, bar]} />
      <View style={[styles.bar, styles.barLine, bar]} />
      <View style={[styles.bar, styles.barShort, bar]} />
    </Animated.View>
  );
}

/** Placeholder cards shown while a list loads (instead of a lone spinner). */
export function SkeletonCards({
  tokens,
  count = 4,
  testID = 'loading-skeleton',
}: {
  tokens: FluentTokens;
  count?: number;
  testID?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <View
      testID={testID}
      style={styles.stack}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} tokens={tokens} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignSelf: 'stretch', gap: 10, paddingHorizontal: 12 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 9 },
  bar: { height: 11, borderRadius: 6 },
  barTitle: { width: '68%', height: 14 },
  barLine: { width: '92%' },
  barShort: { width: '44%' },
});
