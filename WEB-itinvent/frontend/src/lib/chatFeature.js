const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

const isEnabled = (value) => ENABLED_VALUES.has(String(value || '').trim().toLowerCase());

export const CHAT_FEATURE_ENABLED = isEnabled(import.meta.env.VITE_CHAT_ENABLED);
export const CHAT_WS_ENABLED = isEnabled(
  import.meta.env.VITE_CHAT_WS_ENABLED ?? import.meta.env.VITE_CHAT_ENABLED,
);
