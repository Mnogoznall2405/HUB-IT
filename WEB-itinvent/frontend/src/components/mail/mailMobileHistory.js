export const MAIL_MOBILE_HISTORY_FLAG = '__hubMailMobileShell';
export const MAIL_MOBILE_HISTORY_VIEW_KEY = '__hubMailMobileShellView';
export const MAIL_MOBILE_HISTORY_DRAWER_KEY = '__hubMailMobileShellDrawer';
export const MAIL_MOBILE_HISTORY_MESSAGE_KEY = '__hubMailMobileShellMessageId';
export const MAIL_MOBILE_HISTORY_MODE_KEY = '__hubMailMobileShellMode';

export const getMailMobileHistoryKey = (state = {}) => {
  const view = String(state?.view || '').trim() === 'preview' ? 'preview' : 'list';
  const drawerKey = view === 'list' && Boolean(state?.drawerOpen) ? 'open' : 'closed';
  const selectionMode = String(state?.selectionMode || '').trim() === 'conversations' ? 'conversations' : 'messages';
  const previewId = view === 'preview' ? (String(state?.selectedId || '').trim() || 'none') : 'none';
  return `${view}:${drawerKey}:${previewId}:${selectionMode}`;
};

export const readMailMobileHistoryState = (state = null) => {
  if (!state || typeof state !== 'object' || state[MAIL_MOBILE_HISTORY_FLAG] !== true) return null;
  const view = String(state[MAIL_MOBILE_HISTORY_VIEW_KEY] || '').trim() === 'preview' ? 'preview' : 'list';
  const selectionMode = String(state[MAIL_MOBILE_HISTORY_MODE_KEY] || '').trim() === 'conversations' ? 'conversations' : 'messages';
  return {
    view,
    drawerOpen: view === 'list' && Boolean(state[MAIL_MOBILE_HISTORY_DRAWER_KEY]),
    selectedId: view === 'preview' ? String(state[MAIL_MOBILE_HISTORY_MESSAGE_KEY] || '').trim() : '',
    selectionMode,
  };
};

export const buildMailMobileHistoryState = (currentHistoryState = {}, nextState = {}) => {
  const view = String(nextState?.view || '').trim() === 'preview' ? 'preview' : 'list';
  const selectionMode = String(nextState?.selectionMode || '').trim() === 'conversations' ? 'conversations' : 'messages';
  const selectedPreviewId = view === 'preview' ? String(nextState?.selectedId || '').trim() : '';
  const drawerOpen = view === 'list' ? Boolean(nextState?.drawerOpen) : false;
  return {
    nextHistoryState: {
      ...(currentHistoryState && typeof currentHistoryState === 'object' ? currentHistoryState : {}),
      [MAIL_MOBILE_HISTORY_FLAG]: true,
      [MAIL_MOBILE_HISTORY_VIEW_KEY]: view,
      [MAIL_MOBILE_HISTORY_DRAWER_KEY]: drawerOpen,
      [MAIL_MOBILE_HISTORY_MESSAGE_KEY]: selectedPreviewId,
      [MAIL_MOBILE_HISTORY_MODE_KEY]: selectionMode,
    },
    key: getMailMobileHistoryKey({
      view,
      drawerOpen,
      selectedId: selectedPreviewId,
      selectionMode,
    }),
  };
};
