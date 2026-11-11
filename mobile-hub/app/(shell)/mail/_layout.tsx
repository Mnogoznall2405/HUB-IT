import { useReducedMotion } from '../../../src/accessibility/useReducedMotion';
import { Stack } from 'expo-router';
import { useAppFluentTokens } from '../../../src/theme/fluentTokens';

export default function MailLayout() {
  const reduceMotion = useReducedMotion();
  const tokens = useAppFluentTokens();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'slide_from_right',
        contentStyle: { backgroundColor: tokens.pageBg },
        freezeOnBlur: true,
      }}
    />
  );
}
