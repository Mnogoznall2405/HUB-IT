import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { NativeMailSwipeAction } from '../../mail/nativeMailModel';
import { resolveNativeMailSwipeAction } from '../../mail/nativeMailModel';
import type { FluentTokens } from '../../theme/fluentTokens';

const MAX_TRANSLATE = 104;

function clamp(value: number): number {
  return Math.max(-MAX_TRANSLATE, Math.min(MAX_TRANSLATE, value));
}

export function NativeMailSwipeRow({
  children,
  isRead,
  canDelete,
  disabled,
  tokens,
  onAction,
}: {
  children: ReactNode;
  isRead: boolean;
  canDelete: boolean;
  disabled: boolean;
  tokens: FluentTokens;
  onAction: (action: Exclude<NativeMailSwipeAction, null>) => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const resetPosition = useCallback(() => translateX.setValue(0), [translateX]);
  useEffect(() => {
    resetPosition();
  }, [disabled, isRead, resetPosition]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      !disabled
      && Math.abs(gesture.dx) >= 12
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25
    ),
    onPanResponderMove: (_event, gesture) => translateX.setValue(clamp(gesture.dx)),
    onPanResponderRelease: (_event, gesture) => {
      const action = resolveNativeMailSwipeAction(gesture.dx, { isRead, canDelete });
      resetPosition();
      if (action) onAction(action);
    },
    onPanResponderTerminate: resetPosition,
  }), [canDelete, disabled, isRead, onAction, resetPosition, translateX]);

  const readLabel = isRead ? 'Не прочитано' : 'Прочитано';
  return (
    <View style={[styles.host, { backgroundColor: tokens.panelInset }]}>
      <View style={[StyleSheet.absoluteFill, styles.underlay]} pointerEvents="none">
        <View style={[styles.action, { backgroundColor: tokens.primary }]}>
          <MaterialCommunityIcons name={isRead ? 'email-outline' : 'email-open-outline'} size={21} color="#fff" />
          <Text style={styles.actionText}>{readLabel}</Text>
        </View>
        {canDelete ? (
          <View style={[styles.action, styles.trailingAction, { backgroundColor: tokens.error }]}>
            <MaterialCommunityIcons name="trash-can-outline" size={21} color="#fff" />
            <Text style={styles.actionText}>{'Удалить'}</Text>
          </View>
        ) : null}
      </View>
      <Animated.View
        testID="native-mail-swipe-surface"
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { overflow: 'hidden' },
  underlay: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { width: MAX_TRANSLATE, alignItems: 'center', justifyContent: 'center', gap: 3 },
  trailingAction: { marginLeft: 'auto' },
  actionText: { color: '#fff', fontSize: 10, fontWeight: '900' },
});
