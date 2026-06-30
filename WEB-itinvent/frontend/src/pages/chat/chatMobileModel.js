export const CHAT_MOBILE_HISTORY_FLAG = '__hubChatMobileShell';
export const CHAT_MOBILE_HISTORY_VIEW_KEY = '__hubChatMobileShellView';
export const CHAT_MOBILE_HISTORY_DRAWER_KEY = '__hubChatMobileShellDrawer';
export const CHAT_MOBILE_HISTORY_INFO_KEY = '__hubChatMobileShellInfo';

export const CHAT_MOBILE_SCREEN_TRANSITION_MS = 320;
const CHAT_MOBILE_SCREEN_PARALLAX_RATIO = 0.12;
export const CHAT_MOBILE_SCREEN_TRANSITION_EASE = [0.25, 0.1, 0.25, 1];

export const buildChatMobileScreenVariants = ({ motionDisabled = false } = {}) => ({
  enter: (direction) => ({
    x: motionDisabled ? 0 : (direction > 0 ? '100%' : `-${CHAT_MOBILE_SCREEN_PARALLAX_RATIO * 100}%`),
    opacity: 1,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: motionDisabled ? 0 : (direction > 0 ? `-${CHAT_MOBILE_SCREEN_PARALLAX_RATIO * 100}%` : '100%'),
    opacity: 1,
  }),
});

export function resolveChatMobileBottomNavMode(isMobile, hideBottomNav) {
  return isMobile && hideBottomNav ? 'hidden' : 'auto';
}

export function readChatMobileHistoryState(state) {
  if (!state || typeof state !== 'object' || state[CHAT_MOBILE_HISTORY_FLAG] !== true) return null;
  const nextView = String(state[CHAT_MOBILE_HISTORY_VIEW_KEY] || '').trim() === 'thread' ? 'thread' : 'inbox';
  return {
    view: nextView,
    drawerOpen: false,
    infoOpen: nextView === 'thread' && Boolean(state[CHAT_MOBILE_HISTORY_INFO_KEY]),
  };
}
