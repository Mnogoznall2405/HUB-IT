import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

/** Floating "jump to latest" button: scale+fade appear/disappear and a
 * badge that pops when the unread-below counter changes (T7). */
export function ChatJumpToBottomButton({
  visible,
  count,
  onPress,
}: {
  visible: boolean;
  count: number;
  onPress: () => void;
}) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const appear = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const countPop = useRef(new Animated.Value(1)).current;
  const lastCountRef = useRef(count);

  useEffect(() => {
    if (reduceMotion) {
      appear.setValue(visible ? 1 : 0);
      return;
    }
    Animated.spring(appear, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      speed: 26,
      bounciness: 6,
    }).start();
  }, [appear, reduceMotion, visible]);

  useEffect(() => {
    if (!count || count === lastCountRef.current || reduceMotion) {
      lastCountRef.current = count;
      return;
    }
    lastCountRef.current = count;
    countPop.setValue(0.5);
    Animated.spring(countPop, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 8,
    }).start();
  }, [count, countPop, reduceMotion]);

  if (!visible) return null;
  return (
    <Animated.View
      style={[styles.wrap, {
        opacity: appear,
        transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
      }]}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={count > 0
          ? `Перейти вниз. Новых сообщений: ${count}`
          : 'Перейти к последним сообщениям'}
      >
        <MaterialCommunityIcons name="arrow-down" size={24} color={chatTokens.accentText} />
        {count > 0 ? (
          <Animated.View style={[styles.badge, { transform: [{ scale: countPop }] }]}>
            <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    bottom: 76,
  },
  button: {
    minWidth: 48,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: chatTokens.panelBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  badgeText: {
    color: chatTokens.composerActionText,
    fontSize: 11,
    fontWeight: '800',
  },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
});
