import { useEffect } from 'react';

export default function useChatMobileBottomNavEffects({
  isMobile,
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
    // Hide the bottom nav as soon as the thread view is resolved — including
    // deep-link/notification opens where no 'center' transition animation ever
    // completes. The animation-complete hook keeps the animated path working.
    setMobileBottomNavHidden(true);
    return undefined;
  }, [isMobile, resolvedMobileView, setMobileBottomNavHidden]);
}
