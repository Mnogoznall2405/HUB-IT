import { useEffect } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useReducedMotion } from '../accessibility/useReducedMotion';

/** Android uses adjustResize; iOS exposes timing before its frame changes. */
export function useChatKeyboardMotion() {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (Platform.OS !== 'ios' || reduceMotion) return;
    const subscription = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      if (event.duration > 0) Keyboard.scheduleLayoutAnimation(event);
    });
    return () => subscription.remove();
  }, [reduceMotion]);
}
