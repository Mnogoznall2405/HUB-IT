import { Stack } from 'expo-router';
import { chatTokens } from '../../../src/theme/chatTokens';

export default function ChatLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: chatTokens.panelBg },
        headerTintColor: chatTokens.textPrimary,
        headerShown: false,
      }}
    />
  );
}
