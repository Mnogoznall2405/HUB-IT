import { useReducedMotion } from '../../../src/accessibility/useReducedMotion';
import { Stack } from 'expo-router';

export default function TasksLayout() {
  const reduceMotion = useReducedMotion();
  return <Stack screenOptions={{ animation: reduceMotion ? 'none' : 'slide_from_right', headerShown: false }} />;
}
