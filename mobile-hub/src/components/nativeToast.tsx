import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from '../accessibility/useReducedMotion';
import { useChatStyles, type ChatTokens } from '../theme/chatTokens';

// Lightweight global toast for non-blocking feedback. Alerts stay for
// choices; transient success/error notices surface here without stealing
// focus or requiring a tap.
type ToastListener = (message: string) => void;
const listeners = new Set<ToastListener>();

export function showNativeToast(title: string, detail?: string) {
  const head = String(title || '').trim();
  const tail = String(detail || '').trim();
  const text = tail ? `${head}${/[.!?…:]$/.test(head) ? ' ' : '. '}${tail}` : head;
  if (!text) return;
  listeners.forEach((listener) => {
    try { listener(text); } catch { /* Observer only. */ }
  });
}

export function NativeToastHost({ muted = false }: { muted?: boolean }) {
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [message, setMessage] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Сканер живёт в нативной Modal и показывает собственный хост поверх камеры.
  // Внешний хост на это время заглушается, чтобы не продублировать тост после
  // закрытия сканера (слушатель глобальный — без muted он отложил бы показ).
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
    if (muted) setMessage('');
  }, [muted]);

  useEffect(() => {
    const listener: ToastListener = (text) => {
      if (!mutedRef.current) setMessage(text);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!message) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (reduceMotion) {
      opacity.setValue(1);
      hideTimer.current = setTimeout(() => setMessage(''), 2600);
    } else {
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true })
          .start(({ finished }) => { if (finished) setMessage(''); });
      }, 2600);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [message, opacity, reduceMotion]);

  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.layer}>
      <Animated.View style={[styles.toast, { opacity }]}>
        <Text testID="native-toast" numberOfLines={3} style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 88,
    alignItems: 'center',
    zIndex: 60,
  },
  toast: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: 'rgba(28,32,36,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  text: {
    color: '#f2f5f7',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
