import { CHAT_TELEGRAM_SIDEBAR_LAYOUT } from '../../theme/chatTelegramTheme';

export const CHAT_SIDEBAR_MIN = CHAT_TELEGRAM_SIDEBAR_LAYOUT.minWidth;
export const CHAT_SIDEBAR_MAX = CHAT_TELEGRAM_SIDEBAR_LAYOUT.maxWidth;
export const CHAT_SIDEBAR_DEFAULT = CHAT_TELEGRAM_SIDEBAR_LAYOUT.defaultWidth;
export const CHAT_SIDEBAR_RAIL = CHAT_TELEGRAM_SIDEBAR_LAYOUT.railWidth;
export const CHAT_THREAD_MIN = CHAT_TELEGRAM_SIDEBAR_LAYOUT.threadMinWidth;
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
