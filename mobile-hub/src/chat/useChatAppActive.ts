import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

// Only an explicit background/inactive state pauses chat polling. An unknown
// state (null before the native constant arrives) keeps polling enabled, so a
// missing value can never leave a disconnected chat without updates.
function isForeground(state: AppStateStatus | string | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

/**
 * True while the app is in the foreground. Chat fallback polling pauses while
 * the app is backgrounded or inactive (system pickers, permission sheets) and
 * resumes on return, when the hook's owner catches up immediately.
 */
export function useChatAppActive(): boolean {
  const [active, setActive] = useState(() => isForeground(AppState.currentState));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      setActive(isForeground(state));
    });
    return () => subscription.remove();
  }, []);
  return active;
}
