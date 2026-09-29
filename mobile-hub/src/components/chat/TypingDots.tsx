import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { useChatTokens } from '../../theme/chatTokens';

/** Three staggered "typing" dots (Telegram-style), animated on a 1.2s loop. */
export function TypingDots({ color }: { color?: string }) {
  const chatTokens = useChatTokens();
  const reduceMotion = useReducedMotion();
  const dots = [useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current];

  useEffect(() => {
    if (reduceMotion) return undefined;
    const animations = dots.map((dot, index) => Animated.loop(
      Animated.sequence([
        Animated.delay(index * 180),
        Animated.timing(dot, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dot, {
          toValue: 0,
          duration: 320,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay((dots.length - 1 - index) * 180 + 200),
      ]),
    ));
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dots, reduceMotion]);

  const dotColor = color || chatTokens.accentText;
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={[styles.dot, {
            backgroundColor: dotColor,
            opacity: reduceMotion ? 1 : dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{
              translateY: reduceMotion ? 0 : dot.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }),
            }],
          }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 5 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
