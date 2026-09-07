import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { useChatTokens } from '../../theme/chatTokens';

type Context = { mode: 'reply' | 'edit' | null; label?: string; preview?: string };

export function ChatComposerContext({ mode, label, preview, onCancel, onOpen, busy = false }: Context & {
  onCancel?: () => void;
  onOpen?: () => void;
  busy?: boolean;
}) {
  const tokens = useChatTokens();
  const reduceMotion = useReducedMotion();
  const [content, setContent] = useState({ mode, label, preview });
  const [measuredHeight, setMeasuredHeight] = useState(56);
  const height = useRef(new Animated.Value(mode ? 56 : 0)).current;
  const shown = mode ? { mode, label, preview } : content;
  useEffect(() => {
    if (mode) setContent({ mode, label, preview });
    height.stopAnimation();
    const target = mode ? measuredHeight : 0;
    if (reduceMotion) {
      height.setValue(target);
      if (!mode) setContent({ mode: null, label, preview });
      return;
    }
    const animation = Animated.timing(height, { toValue: target, duration: 180, useNativeDriver: false });
    let active = true;
    animation.start(({ finished }) => {
      if (active && finished && !mode) setContent({ mode: null, label, preview });
    });
    return () => { active = false; animation.stop(); };
  }, [height, label, measuredHeight, mode, preview, reduceMotion]);
  return (
    <Animated.View testID="chat-composer-context" style={{ height, overflow: 'hidden' }}
      pointerEvents={mode ? 'auto' : 'none'} accessibilityElementsHidden={!mode} importantForAccessibility={mode ? 'auto' : 'no-hide-descendants'}>
      {shown.mode ? <View onLayout={(event) => setMeasuredHeight(Math.max(56, event.nativeEvent.layout.height))}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, minHeight: 56, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable disabled={!onOpen} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Перейти к исходному сообщению"
          style={{ flex: 1, minWidth: 0, borderLeftWidth: 3, borderLeftColor: tokens.accentText, paddingLeft: 8 }}>
          <Text numberOfLines={1} style={{ color: tokens.accentText, fontWeight: '700' }}>{shown.mode === 'edit' ? 'Редактирование' : shown.label || 'Ответ'}</Text>
          <Text numberOfLines={2} style={{ color: tokens.textSecondary }}>{shown.preview || 'Сообщение'}</Text>
        </Pressable>
        <Pressable onPress={onCancel} disabled={busy} accessibilityState={{ disabled: busy }} accessibilityRole="button" accessibilityLabel={shown.mode === 'edit' ? 'Отменить редактирование' : 'Отменить ответ'}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: tokens.textSecondary, fontSize: 24 }}>×</Text>
        </Pressable>
      </View> : null}
    </Animated.View>
  );
}
