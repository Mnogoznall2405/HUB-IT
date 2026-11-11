export const OUTGOING_BOTTOM_SETTLE_FRAMES = 2;

export const isChatLayoutKeyboardOpen = (container) => {
  const layoutHeight = Math.round(Number(window.innerHeight || document.documentElement?.clientHeight || 0));
  const clientHeight = Math.round(Number(container?.clientHeight || 0));
  if (clientHeight <= 0 || layoutHeight <= 0) return false;
  return (layoutHeight - clientHeight) > 180;
};

export const getChatBottomInstantSettleFrames = ({
  userInitiated = false,
  mobileKeyboardDeferred = false,
} = {}) => {
  if (mobileKeyboardDeferred) return userInitiated ? 4 : 3;
  return userInitiated ? OUTGOING_BOTTOM_SETTLE_FRAMES : 1;
};
