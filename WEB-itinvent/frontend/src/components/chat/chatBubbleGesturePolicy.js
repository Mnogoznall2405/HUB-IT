const LONG_PRESS_SCROLL_CANCEL_PX = 30;
const LONG_PRESS_HORIZONTAL_CANCEL_PX = 44;

export const isMobileMessageLongPress = ({
  mobileInteractionsEnabled = false,
  compactMobile = false,
} = {}) => Boolean(mobileInteractionsEnabled || compactMobile);

export const shouldCancelLongPressMove = ({
  startX = 0,
  startY = 0,
  currentX = 0,
  currentY = 0,
} = {}) => {
  const deltaX = Math.abs(Number(currentX || 0) - Number(startX || 0));
  const deltaY = Math.abs(Number(currentY || 0) - Number(startY || 0));
  if (deltaY >= LONG_PRESS_SCROLL_CANCEL_PX && deltaY > deltaX + 8) return true;
  if (deltaX >= LONG_PRESS_HORIZONTAL_CANCEL_PX && deltaX > deltaY + 16) return true;
  return false;
};

export const shouldSuppressNativeMessageGesture = ({
  mobileInteractionsEnabled = false,
  compactMobile = false,
} = {}) => isMobileMessageLongPress({ mobileInteractionsEnabled, compactMobile });

export const shouldAnimateChatBubble = ({
  prefersReducedMotion = false,
  compactMobile = false,
  isOwn = false,
  isOptimistic = false,
  isSending = false,
} = {}) => {
  if (prefersReducedMotion) return false;
  if (isOwn) return false;
  if (compactMobile && !isOptimistic) return false;
  return true;
};
