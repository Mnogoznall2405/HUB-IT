import { useReducedMotion } from '../../../src/accessibility/useReducedMotion';
import { Stack } from 'expo-router';
import { useChatTokens } from '../../../src/theme/chatTokens';

export default function ShellChatLayout() {
  const reduceMotion = useReducedMotion();
  const chatTokens = useChatTokens();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'slide_from_right',
        contentStyle: { backgroundColor: chatTokens.threadBg },
        freezeOnBlur: true,
      }}
    />
  );
}
