import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function ChatReactionButton({ children, onPress, label, style }: {
  children: ReactNode;
  onPress?: () => void;
  label: string;
  style: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => () => scale.stopAnimation(), [scale]);
  const animate = (value: number) => {
    scale.stopAnimation();
    if (reduceMotion) { scale.setValue(1); return; }
    Animated.timing(scale, { toValue: value, duration: 100, useNativeDriver: true }).start();
  };
  return <AnimatedPressable onPress={onPress} disabled={!onPress} onPressIn={() => animate(0.96)} onPressOut={() => animate(1)}
    accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}
    style={[style, { transform: [{ scale }] }]}>{children}</AnimatedPressable>;
}
