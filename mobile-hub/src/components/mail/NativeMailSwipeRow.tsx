import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRef, type PropsWithChildren } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  resolveNativeMailSwipeAction,
  resolveNativeMailSwipeAvailability,
  type NativeMailSwipeAction,
  type NativeMailSwipeSetting,
} from '../../mail/nativeMailModel';
import type { useFluentTokens } from '../../theme/fluentTokens';

const MAX_TRANSLATE = 104;

type SwipeVisual = { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; destructive: boolean };

function swipeVisual(action: NativeMailSwipeSetting | 'delete-forever', isRead: boolean): SwipeVisual | null {
  if (action === 'toggle-read') {
    return { icon: isRead ? 'email-outline' : 'email-open-outline', label: isRead ? 'Не прочитано' : 'Прочитано', destructive: false };
  }
  if (action === 'archive') return { icon: 'archive-arrow-down-outline', label: 'Архив', destructive: false };
  if (action === 'delete') return { icon: 'trash-can-outline', label: 'Удалить', destructive: true };
  if (action === 'delete-forever') return { icon: 'delete-forever-outline', label: 'Удалить навсегда', destructive: true };
  return null;
}

export function NativeMailSwipeRow({
  children,
  disabled,
  isRead,
  canArchive,
  canDelete,
  canDeleteForever,
  swipeRight,
  swipeLeft,
  tokens,
  onAction,
}: PropsWithChildren<{
  disabled?: boolean;
  isRead: boolean;
  canArchive?: boolean;
  canDelete?: boolean;
  canDeleteForever?: boolean;
  swipeRight?: NativeMailSwipeSetting;
  swipeLeft?: NativeMailSwipeSetting;
  tokens: ReturnType<typeof useFluentTokens>;
  onAction: (action: Exclude<NativeMailSwipeAction, null>) => Promise<void> | void;
}>) {
  const translateX = useRef(new Animated.Value(0)).current;
  const actionInProgress = useRef(false);
  const reduceMotion = useReducedMotion();
  const current = useRef({ disabled, isRead, canArchive, canDelete, canDeleteForever, swipeRight, swipeLeft, onAction });
  current.current = { disabled, isRead, canArchive, canDelete, canDeleteForever, swipeRight, swipeLeft, onAction };

  const capabilities = { canArchive, canDelete, canDeleteForever };
  const leadingSetting: NativeMailSwipeSetting = swipeRight || 'toggle-read';
  const trailingSetting: NativeMailSwipeSetting | 'delete-forever' = canDeleteForever ? 'delete-forever' : (swipeLeft || 'archive');
  const leadingAvailable = !disabled && leadingSetting !== 'none'
    && resolveNativeMailSwipeAvailability(leadingSetting, capabilities);
  const trailingAvailable = !disabled && (trailingSetting === 'delete-forever'
    ? true
    : trailingSetting !== 'none' && resolveNativeMailSwipeAvailability(trailingSetting, capabilities));

  const reset = () => {
    if (reduceMotion) {
      translateX.setValue(0);
      return;
    }
    Animated.spring(translateX, {
      toValue: 0,
      bounciness: 0,
      speed: 28,
      useNativeDriver: true,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => {
        if (current.current.disabled || actionInProgress.current) return false;
        const leadingAllowed = resolveNativeMailSwipeAvailability(current.current.swipeRight || 'toggle-read', current.current);
        const trailingAllowed = current.current.canDeleteForever
          ? true
          : resolveNativeMailSwipeAvailability(current.current.swipeLeft || 'archive', current.current);
        if (gesture.dx > 0 && !leadingAllowed) return false;
        if (gesture.dx < 0 && !trailingAllowed) return false;
        return Math.abs(gesture.dx) > 16
          && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6;
      },
      onPanResponderMove: (_event, gesture) => {
        const clamped = Math.max(-MAX_TRANSLATE, Math.min(MAX_TRANSLATE, gesture.dx));
        translateX.setValue(clamped);
      },
      onPanResponderRelease: (_event, gesture) => {
        if (current.current.disabled || Math.abs(gesture.dy) >= Math.abs(gesture.dx)) { reset(); return; }
        const resolved = resolveNativeMailSwipeAction(gesture.dx, current.current);
        reset();
        if (!resolved || actionInProgress.current) return;
        actionInProgress.current = true;
        Promise.resolve(current.current.onAction(resolved)).catch(() => undefined).finally(() => {
          actionInProgress.current = false;
        });
      },
      onPanResponderTerminate: () => reset(),
    }),
  ).current;

  const leading = leadingAvailable ? swipeVisual(leadingSetting, isRead) : null;
  const trailing = trailingAvailable ? swipeVisual(trailingSetting, isRead) : null;

  return (
    <View style={styles.clip}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.underlay}>
          {leading ? (
            <View style={[styles.action, styles.leading, { backgroundColor: leading.destructive ? tokens.error : tokens.primary }]}>
              <MaterialCommunityIcons name={leading.icon} size={19} color="#fff" />
              <Text style={[styles.actionText, { color: '#fff' }]} numberOfLines={2}>{leading.label}</Text>
            </View>
          ) : <View style={styles.action} />}
          {trailing ? (
            <View style={[styles.action, styles.trailing, { backgroundColor: trailing.destructive ? tokens.error : tokens.primary }]}>
              <MaterialCommunityIcons name={trailing.icon} size={19} color="#fff" />
              <Text style={[styles.actionText, { color: '#fff' }]} numberOfLines={2}>{trailing.label}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  underlay: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  action: { width: MAX_TRANSLATE, alignItems: 'center', justifyContent: 'center', gap: 2 },
  leading: { alignSelf: 'flex-start' },
  trailing: { alignSelf: 'flex-end' },
  actionText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
});
