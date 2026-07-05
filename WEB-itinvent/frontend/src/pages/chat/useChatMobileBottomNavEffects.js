import { useEffect } from 'react';

export default function useChatMobileBottomNavEffects({
  isMobile,
  mobileMotionDisabled,
  resolvedMobileView,
  setMobileBottomNavHidden,
}) {
  useEffect(() => {
    if (!isMobile) {
      setMobileBottomNavHidden(false);
      return undefined;
    }
    if (resolvedMobileView !== 'thread') {
      setMobileBottomNavHidden(false);
      return undefined;
    }
    if (mobileMotionDisabled) {
      setMobileBottomNavHidden(true);
    }
    return undefined;
  }, [isMobile, mobileMotionDisabled, resolvedMobileView, setMobileBottomNavHidden]);
}
