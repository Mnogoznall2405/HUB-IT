import { CHAT_FEATURE_ENABLED } from './chatFeature';

export function hasAnyAppPushPermission(hasPermission, { chatFeatureEnabled = CHAT_FEATURE_ENABLED } = {}) {
  if (typeof hasPermission !== 'function') return false;
  return Boolean(
    hasPermission('mail.access')
    || hasPermission('tasks.read')
    || hasPermission('dashboard.read')
    || (chatFeatureEnabled && hasPermission('chat.read'))
  );
}
