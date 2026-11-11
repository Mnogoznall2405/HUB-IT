import { useCallback } from 'react';

export default function useChatMobileThreadAnimation({
  isMobile,
  mobileMotionDisabled,
  resolvedMobileView,
  setMobileBottomNavHidden,
}) {
  return useCallback((definition) => {
    if (definition !== 'center') return;
    if (!isMobile || mobileMotionDisabled) return;
    if (resolvedMobileView !== 'thread') return;
    setMobileBottomNavHidden(true);
  }, [isMobile, mobileMotionDisabled, resolvedMobileView, setMobileBottomNavHidden]);
}
