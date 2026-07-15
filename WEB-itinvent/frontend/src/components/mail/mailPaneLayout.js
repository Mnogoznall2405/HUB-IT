export const MAIL_PANE_DEFAULTS = Object.freeze({
  folder_pane_width: 220,
  message_list_width: 360,
  bottom_list_percent: 42,
});

export const MAIL_PANE_LIMITS = Object.freeze({
  folder_pane_width: Object.freeze({ min: 180, max: 360, step: 10, unit: 'px' }),
  message_list_width: Object.freeze({ min: 280, max: 720, step: 10, unit: 'px' }),
  bottom_list_percent: Object.freeze({ min: 25, max: 75, step: 2, unit: '%' }),
});

export const clampMailPaneSize = (key, value) => {
  const limits = MAIL_PANE_LIMITS[key];
  const fallback = MAIL_PANE_DEFAULTS[key];
  if (!limits) return Number(fallback || 0);
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) ? Math.round(numeric) : fallback;
  return Math.max(limits.min, Math.min(limits.max, normalized));
};

export const getMailPaneSizes = (preferences = {}) => ({
  folder_pane_width: clampMailPaneSize('folder_pane_width', preferences?.folder_pane_width),
  message_list_width: clampMailPaneSize('message_list_width', preferences?.message_list_width),
  bottom_list_percent: clampMailPaneSize('bottom_list_percent', preferences?.bottom_list_percent),
});

export const getMailPaneCssValue = (key, value) => {
  const limits = MAIL_PANE_LIMITS[key];
  return `${clampMailPaneSize(key, value)}${limits?.unit || 'px'}`;
};
