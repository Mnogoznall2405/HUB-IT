import { Stack } from 'expo-router';
import { useAppFluentTokens } from '../../../src/theme/fluentTokens';

export default function MailLayout() {
  const tokens = useAppFluentTokens();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: tokens.pageBg },
        freezeOnBlur: true,
      }}
    />
  );
}
