import { useCallback } from 'react';

import { peekSWRCache } from '../../lib/swrCache';
import { hasFreshMailDetailCache } from './mailDetailModel';

export default function useMailFreshSelectedDetail({
  mailAccessReady,
  selectedId,
  viewMode,
  folderScope,
  mailCacheScope,
  folder,
  staleTimeMs,
  peekCache = peekSWRCache,
} = {}) {
  return useCallback(({
    detailId = selectedId,
    mode = viewMode,
  } = {}) => hasFreshMailDetailCache({
    mailAccessReady,
    detailId,
    viewMode: mode,
    folderScope,
    mailCacheScope,
    folder,
    peekCache,
    staleTimeMs,
  }), [
    folder,
    folderScope,
    mailAccessReady,
    mailCacheScope,
    peekCache,
    selectedId,
    staleTimeMs,
    viewMode,
  ]);
}
