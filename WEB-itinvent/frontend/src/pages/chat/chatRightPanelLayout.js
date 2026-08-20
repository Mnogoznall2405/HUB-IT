export const CHAT_RIGHT_PANEL_WIDTH_STORAGE_KEY = 'hub.chat.rightPanelWidth';
export const CHAT_TASK_PANEL_COLLAPSED_STORAGE_KEY = 'hub.chat.taskPanelCollapsed';
export const CHAT_RIGHT_PANEL_MIN_WIDTH = 320;
export const CHAT_RIGHT_PANEL_MAX_WIDTH = 400;
export const CHAT_RIGHT_PANEL_DEFAULT_WIDTH = 380;
export const CHAT_WIDE_DESKTOP_ENTER_PX = 1440;
export const CHAT_WIDE_DESKTOP_EXIT_PX = 1280;
export const CHAT_WIDE_DESKTOP_MEDIA = `(min-width:${CHAT_WIDE_DESKTOP_ENTER_PX}px)`;
export const CHAT_WIDE_DESKTOP_EXIT_MEDIA = `(min-width:${CHAT_WIDE_DESKTOP_EXIT_PX}px)`;

export function resolveWideDesktopLayout({
  currentlyWide = false,
  matchesEnter = false,
  matchesExit = false,
} = {}) {
  return currentlyWide ? Boolean(matchesExit) : Boolean(matchesEnter);
}

export function clampChatRightPanelWidth(value, fallback = CHAT_RIGHT_PANEL_DEFAULT_WIDTH) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(CHAT_RIGHT_PANEL_MAX_WIDTH, Math.max(CHAT_RIGHT_PANEL_MIN_WIDTH, Math.round(numeric)));
}

export function readStoredChatRightPanelWidth(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    const raw = storage?.getItem?.(CHAT_RIGHT_PANEL_WIDTH_STORAGE_KEY);
    return clampChatRightPanelWidth(raw, CHAT_RIGHT_PANEL_DEFAULT_WIDTH);
  } catch {
    return CHAT_RIGHT_PANEL_DEFAULT_WIDTH;
  }
}

export function persistChatRightPanelWidth(value, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  const next = clampChatRightPanelWidth(value);
  try {
    storage?.setItem?.(CHAT_RIGHT_PANEL_WIDTH_STORAGE_KEY, String(next));
  } catch {
    // Ignore quota / private-mode failures.
  }
  return next;
}

export function readStoredChatTaskPanelCollapsed(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    return storage?.getItem?.(CHAT_TASK_PANEL_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistChatTaskPanelCollapsed(collapsed, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    storage?.setItem?.(CHAT_TASK_PANEL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Ignore quota / private-mode failures.
  }
  return Boolean(collapsed);
}

export function resolveChatDesktopGridTemplateColumns({
  sidebarMin = 320,
  sidebarMax = 340,
  rightPanelWidth = CHAT_RIGHT_PANEL_DEFAULT_WIDTH,
  persistent = false,
} = {}) {
  const sidebar = `minmax(${sidebarMin}px, ${sidebarMax}px)`;
  const thread = 'minmax(500px, 1fr)';
  if (!persistent) return `${sidebar} minmax(0, 1fr)`;
  return `${sidebar} ${thread} ${clampChatRightPanelWidth(rightPanelWidth)}px`;
}
