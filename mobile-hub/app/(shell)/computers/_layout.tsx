import { useReducedMotion } from '../../../src/accessibility/useReducedMotion';
import { Stack } from 'expo-router';

export default function ComputersLayout() {
  const reduceMotion = useReducedMotion();
  return <Stack screenOptions={{ animation: reduceMotion ? 'none' : 'slide_from_right', headerShown: false }} />;
}
