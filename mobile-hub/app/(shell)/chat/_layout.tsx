import { Stack } from 'expo-router';
import { useChatTokens } from '../../../src/theme/chatTokens';

export default function ShellChatLayout() {
  const chatTokens = useChatTokens();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: chatTokens.threadBg },
        freezeOnBlur: true,
      }}
    />
  );
}
