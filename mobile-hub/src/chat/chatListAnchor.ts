export const CHAT_NEAR_BOTTOM_OFFSET = 96;

export type ChatListAnchorReason =
  | 'own-send'
  | 'incoming'
  | 'composer-layout'
  | 'prepend-older'
  | 'layout'
  | 'jump';

export function isNearBottomOffset(offsetY: number): boolean {
  return Number(offsetY) < CHAT_NEAR_BOTTOM_OFFSET;
}

export function shouldUseMaintainVisibleContentPosition(loadingOlder: boolean, nearBottom = true): boolean {
  return Boolean(loadingOlder) || !nearBottom;
}

export function shouldRequestBottomAnchor(
  reason: ChatListAnchorReason,
  nearBottom: boolean,
): boolean {
  if (reason === 'prepend-older') return false;
  if (reason === 'composer-layout') return Boolean(nearBottom);
  if (reason === 'own-send' || reason === 'jump') return true;
  return Boolean(nearBottom);
}

export function shouldAnimateBottomAnchor(
  reason: ChatListAnchorReason,
  reduceMotion: boolean,
): boolean {
  if (reduceMotion) return false;
  if (reason === 'own-send' || reason === 'composer-layout' || reason === 'layout') return false;
  return true;
}
