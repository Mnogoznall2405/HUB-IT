export const BACK_SWIPE_EDGE_DP = 16;
export const BACK_SWIPE_START_DP = 14;
export const BACK_SWIPE_TRIGGER_DP = 84;
export const FOLDER_SWIPE_START_DP = 14;
export const FOLDER_SWIPE_TRIGGER_DP = 80;
export const MEDIA_DISMISS_TRIGGER_DP = 80;
export const INBOX_ROW_SWIPE_START_DP = 20;
export const INBOX_ROW_SWIPE_TRIGGER_DP = 72;

export function shouldTrackEdgeBackSwipe(startX: number): boolean {
  return startX >= 0 && startX <= BACK_SWIPE_EDGE_DP;
}

export function shouldEngageEdgeBackSwipe(dx: number, dy: number): boolean {
  if (dx < BACK_SWIPE_START_DP) return false;
  if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) return false;
  return Math.abs(dx) > Math.abs(dy) + 4;
}

export function shouldTriggerEdgeBackSwipe(dx: number, engaged: boolean): boolean {
  return engaged && dx >= BACK_SWIPE_TRIGGER_DP;
}

export function shouldKeepHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy);
}

export function shouldStartFolderSwipe(dx: number, dy: number): boolean {
  if (Math.abs(dx) < FOLDER_SWIPE_START_DP) return false;
  if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) return false;
  return Math.abs(dx) > Math.abs(dy) + 4;
}

export function shouldLockInboxRefresh(dx: number, dy: number): boolean {
  return Math.abs(dx) >= 8 && Math.abs(dx) >= Math.abs(dy);
}

export function shouldTriggerFolderSwipe(dx: number): boolean {
  return Math.abs(dx) >= FOLDER_SWIPE_TRIGGER_DP;
}

export function folderSwipeDirection(dx: number): 'next' | 'prev' {
  return dx < 0 ? 'next' : 'prev';
}

export function shouldDismissMediaViewer(dx: number, dy: number): boolean {
  return dy >= MEDIA_DISMISS_TRIGGER_DP && dy > Math.abs(dx);
}

export function shouldStartInboxRowSwipe(dx: number, dy: number): boolean {
  if (Math.abs(dx) < INBOX_ROW_SWIPE_START_DP) return false;
  if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) return false;
  return Math.abs(dx) > Math.abs(dy) + 4;
}

export function inboxRowSwipeAction(dx: number): 'mute' | 'archive' | null {
  if (dx >= INBOX_ROW_SWIPE_TRIGGER_DP) return 'mute';
  if (dx <= -INBOX_ROW_SWIPE_TRIGGER_DP) return 'archive';
  return null;
}

export function nextInboxRowSettings(
  item: { is_muted?: boolean; is_archived?: boolean },
  action: 'mute' | 'archive',
): { is_muted: boolean } | { is_archived: boolean } {
  if (action === 'mute') return { is_muted: !Boolean(item.is_muted) };
  return { is_archived: !Boolean(item.is_archived) };
}

export type ChatThreadBackLayer =
  | 'viewer'
  | 'voice'
  | 'sheet'
  | 'forward'
  | 'search'
  | 'selection'
  | 'picker'
  | 'inbox';

export function nextChatThreadBackAction(layers: {
  viewer?: boolean;
  voice?: boolean;
  sheet?: boolean;
  forward?: boolean;
  search?: boolean;
  selection?: boolean;
  picker?: boolean;
}): ChatThreadBackLayer {
  if (layers.viewer) return 'viewer';
  if (layers.voice) return 'voice';
  if (layers.sheet) return 'sheet';
  if (layers.forward) return 'forward';
  if (layers.search) return 'search';
  if (layers.selection) return 'selection';
  if (layers.picker) return 'picker';
  return 'inbox';
}
