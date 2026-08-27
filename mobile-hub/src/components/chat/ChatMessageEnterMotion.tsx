import { memo, useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import type { ChatMessage } from '../../api/types';

export type ChatMessageEnterKind = 'outgoing' | 'incoming';

export const CHAT_MESSAGE_ENTER_DURATION_MS = 250;

export function chatMessageMotionKey(
  message: Pick<ChatMessage, 'id' | 'client_message_id' | 'sender_user_id'>,
): string {
  const clientMessageId = String(message.client_message_id || '').trim();
  const senderId = Number(message.sender_user_id || 0);
  return clientMessageId
    ? `client:${senderId}:${clientMessageId}`
    : `message:${String(message.id || '').trim()}`;
}

export const ChatMessageEnterMotion = memo(function ChatMessageEnterMotion({
  motionKey,
  kind,
  reduceMotion,
  onFinished,
  children,
}: {
  motionKey: string;
  kind: ChatMessageEnterKind;
  reduceMotion: boolean;
  onFinished: (motionKey: string) => void;
  children: ReactNode;
}) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      onFinishedRef.current(motionKey);
      return undefined;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: CHAT_MESSAGE_ENTER_DURATION_MS,
      easing: Easing.bezier(0.2, 0.01, 0.28, 0.91),
      useNativeDriver: true,
    });
    animation.start(() => {
      progress.setValue(1);
      onFinishedRef.current(motionKey);
    });
    return () => {
      animation.stop();
      onFinishedRef.current(motionKey);
    };
  }, [motionKey, progress, reduceMotion]);

  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: kind === 'outgoing' ? [0.72, 1] : [0.12, 1],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: kind === 'outgoing' ? [36, 0] : [12, 0],
  });
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: kind === 'outgoing' ? [14, 0] : [0, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });

  return (
    <Animated.View
      testID={`chat-message-enter-${kind}`}
      style={{
        opacity,
        transform: [{ translateY }, { translateX }, { scale }],
      }}
    >
      {children}
    </Animated.View>
  );
});
