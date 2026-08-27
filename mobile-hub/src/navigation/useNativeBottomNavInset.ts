import { initialWindowMetrics } from 'react-native-safe-area-context';
import { NATIVE_BOTTOM_NAV_CONTENT_HEIGHT } from '../theme/fluentTokens';

export function useNativeBottomNavInset(hidden = false): number {
  if (hidden) return 0;
  return NATIVE_BOTTOM_NAV_CONTENT_HEIGHT + (initialWindowMetrics?.insets.bottom || 0);
}
