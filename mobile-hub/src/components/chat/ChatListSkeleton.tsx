import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

/** Skeleton rows shown while chat data loads without a cached snapshot (U4). */
export function ChatConversationSkeleton({ count = 8 }: { count?: number }) {
  const { styles } = useChatStyles(createConversationStyles);
  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonPulse key={index} delay={index * 90}>
          <View style={styles.row}>
            <View style={styles.avatar} />
            <View style={styles.lines}>
              <View style={[styles.line, { width: `${52 + (index % 3) * 14}%` }]} />
              <View style={[styles.line, styles.lineThin, { width: `${34 + (index % 4) * 12}%` }]} />
            </View>
          </View>
        </SkeletonPulse>
      ))}
    </View>
  );
}

/** Skeleton bubbles for the thread screen. */
export function ChatThreadSkeleton({ count = 10 }: { count?: number }) {
  const { styles } = useChatStyles(createThreadStyles);
  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, index) => {
        const own = index % 3 === 2;
        return (
          <SkeletonPulse key={index} delay={index * 80}>
            <View style={[styles.bubble, own && styles.bubbleOwn, {
              width: `${38 + ((index * 37) % 40)}%`,
              height: 34 + (index % 2) * 18,
            }]} />
          </SkeletonPulse>
        );
      })}
    </View>
  );
}

function SkeletonPulse({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduceMotion) { opacity.setValue(0.75); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.55, duration: 550, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [delay, opacity, reduceMotion]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

const createConversationStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: { flex: 1, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: chatTokens.sidebarSearchBg },
  lines: { flex: 1, gap: 8 },
  line: { height: 13, borderRadius: 6, backgroundColor: chatTokens.sidebarSearchBg },
  lineThin: { height: 10 },
});

const createThreadStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', padding: 12, gap: 10 },
  bubble: { borderRadius: 14, backgroundColor: chatTokens.sidebarSearchBg },
  bubbleOwn: { alignSelf: 'flex-end', backgroundColor: chatTokens.bubbleOwnBg, opacity: 0.7 },
});
