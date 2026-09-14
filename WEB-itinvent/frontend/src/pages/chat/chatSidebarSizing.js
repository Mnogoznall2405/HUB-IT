export const CHAT_SIDEBAR_MIN = 280;
export const CHAT_SIDEBAR_MAX = 440;
export const CHAT_SIDEBAR_DEFAULT = 320;
export const CHAT_SIDEBAR_RAIL = 72;
export const CHAT_THREAD_MIN = 360;
const STORAGE_KEY = 'hub.chat.sidebarLayout';

export function clampSidebarWidth(value) {
  const width = Number(value);
  return Number.isFinite(width) && width > 0
    ? Math.min(CHAT_SIDEBAR_MAX, Math.max(CHAT_SIDEBAR_MIN, Math.round(width)))
    : CHAT_SIDEBAR_DEFAULT;
}

export function readSidebarLayout(storage) {
  try {
    const saved = JSON.parse((storage ?? window.localStorage).getItem(STORAGE_KEY) || '{}');
    return { width: clampSidebarWidth(saved.width), collapsed: saved.collapsed === true };
  } catch {
    return { width: CHAT_SIDEBAR_DEFAULT, collapsed: false };
  }
}

export function persistSidebarLayout(value) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Private mode / quota. */ }
}

export function resolveSidebarWidth(width, containerWidth, rightPanelWidth = 0) {
  const available = containerWidth > 0 ? containerWidth - rightPanelWidth - CHAT_THREAD_MIN : CHAT_SIDEBAR_MAX;
  return Math.max(CHAT_SIDEBAR_MIN, Math.min(clampSidebarWidth(width), available));
}
