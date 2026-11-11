import { useReducedMotion } from '../../../src/accessibility/useReducedMotion';
import { Stack } from 'expo-router';

export default function DatabaseLayout() {
  const reduceMotion = useReducedMotion();
  return <Stack screenOptions={{ headerShown: false, animation: reduceMotion ? 'none' : 'slide_from_right' }} />;
}
