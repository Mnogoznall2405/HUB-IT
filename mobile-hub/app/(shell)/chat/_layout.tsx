import { useReducedMotion } from '../../../src/accessibility/useReducedMotion';
import { Stack } from 'expo-router';

export default function ShellChatLayout() {
  const reduceMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'slide_from_right',
        animationDuration: 280,
        // Transparent: each screen paints its own background (threadBg/sidebarBg).
        // Required for the interactive back gesture — dragging the thread
        // content aside reveals the inbox screen mounted underneath.
        contentStyle: { backgroundColor: 'transparent' },
        freezeOnBlur: true,
      }}
    />
  );
}
