import { Stack } from 'expo-router';
import { useReducedMotion } from '../../../src/accessibility/useReducedMotion';
export default function ConstructionLayout() {
  const reducedMotion = useReducedMotion();
  return <Stack screenOptions={{ headerShown: false, animation: reducedMotion ? 'none' : 'slide_from_right' }} />;
}
