import { useContext } from 'react';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import { bottomNavMetrics } from './bottomNavMetrics';

export function useNativeBottomNavInset(hidden = false): number {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const { fontScale } = useWindowDimensions();
  if (hidden) return 0;
  return bottomNavMetrics(fontScale).contentHeight + Math.max(insets?.bottom || 0, 9);
}
