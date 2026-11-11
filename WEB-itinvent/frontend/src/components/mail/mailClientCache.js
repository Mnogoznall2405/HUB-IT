import { clearMailRecentCacheForScope } from '../../lib/mailRecentCache';
import { invalidateSWRCacheByPrefix } from '../../lib/swrCache';

export const DEFAULT_MAIL_CLIENT_CACHE_PREFIXES = Object.freeze([
  'bootstrap',
  'folder-summary',
  'folder-tree',
  'list',
  'message-detail',
  'conversation-detail',
]);

export function invalidateMailClientCacheForScope(
  scope,
  prefixes = DEFAULT_MAIL_CLIENT_CACHE_PREFIXES,
  {
    invalidateByPrefix = invalidateSWRCacheByPrefix,
    clearRecentCache = clearMailRecentCacheForScope,
  } = {},
) {
  (Array.isArray(prefixes) ? prefixes : []).forEach((prefix) => {
    invalidateByPrefix('mail', scope, prefix);
  });
  clearRecentCache(scope);
}
