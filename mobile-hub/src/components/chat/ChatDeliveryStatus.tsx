import { useEffect, useRef } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Animated, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';

export function ChatDeliveryStatus({ status, color }: { status: 'sending' | 'sent' | 'read' | 'failed'; color: string }) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) { opacity.setValue(1); return; }
    opacity.setValue(0.4);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion, status]);
  const label = { sending: 'Сообщение отправляется', sent: 'Отправлено', read: 'Прочитано', failed: 'Не отправлено' }[status];
  return <View testID="chat-delivery-status" accessible={status !== 'failed'} accessibilityLabel={label} style={{ width: 24, height: 16, marginLeft: 3, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View style={{ opacity }}>
      {status === 'sending' ? <MaterialCommunityIcons testID="chat-message-sending-clock" name="clock-outline" size={13} color={color} />
        : status === 'failed' ? null
        : <MaterialCommunityIcons name={status === 'read' ? 'check-all' : 'check'} size={13} color={color} />}
    </Animated.View>
  </View>;
}
