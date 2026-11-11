import { useCallback } from 'react';

import {
  DEFAULT_MAIL_CLIENT_CACHE_PREFIXES,
  invalidateMailClientCacheForScope,
} from './mailClientCache';

export default function useMailClientCacheInvalidation({ mailCacheScope } = {}) {
  return useCallback((prefixes = DEFAULT_MAIL_CLIENT_CACHE_PREFIXES) => {
    invalidateMailClientCacheForScope(mailCacheScope, prefixes);
  }, [mailCacheScope]);
}
