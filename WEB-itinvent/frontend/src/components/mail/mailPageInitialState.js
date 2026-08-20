import { useMemo } from 'react';

import { getMailRecentHydration } from '../../lib/mailRecentCache';
import { buildMailListRequestContext } from './mailListModel';
import {
  normalizeMailboxId,
  readStoredSelectedMailboxId,
} from './mailMailboxModel';
import { readStoredMailViewState } from './mailViewStateModel';

export function resolveMailPageInitialState({
  locationSearch = '',
  userId = '',
  defaultAdvancedFilters = {},
  selectedMailboxStorage,
  viewStateStorage,
  getRecentHydration = getMailRecentHydration,
} = {}) {
  const initialRouteMailboxId = normalizeMailboxId(
    new URLSearchParams(locationSearch || '').get('mailbox_id'),
  );
  const mailboxReadOptions = selectedMailboxStorage !== undefined
    ? { storage: selectedMailboxStorage }
    : undefined;
  const initialStoredMailboxId = initialRouteMailboxId
    ? ''
    : readStoredSelectedMailboxId(mailboxReadOptions);
  const initialSelectedMailboxId = initialRouteMailboxId || initialStoredMailboxId;
  const viewStateOptions = viewStateStorage !== undefined
    ? { storage: viewStateStorage, defaultAdvancedFilters }
    : { defaultAdvancedFilters };
  const initialMailViewState = readStoredMailViewState(initialSelectedMailboxId, viewStateOptions);
  const initialMailCacheScope = initialSelectedMailboxId || String(userId || 'anonymous');
  const initialMailRecentContextKey = buildMailListRequestContext({
    scope: initialMailCacheScope,
    folder: initialMailViewState.folder,
    viewMode: initialMailViewState.viewMode,
    search: initialMailViewState.search,
    unreadOnly: initialMailViewState.unreadOnly,
    hasAttachmentsOnly: initialMailViewState.hasAttachmentsOnly,
    dateFrom: initialMailViewState.filterDateFrom,
    dateTo: initialMailViewState.filterDateTo,
    advancedFilters: initialMailViewState?.advancedFiltersApplied,
    limit: 50,
    offset: 0,
  }).contextKey;
  const initialMailRecentHydration = getRecentHydration({
    scope: initialMailCacheScope,
    contextKey: initialMailRecentContextKey,
  });
  return {
    initialRouteMailboxId,
    initialSelectedMailboxId,
    initialMailViewState,
    initialMailCacheScope,
    initialMailRecentHydration,
  };
}

export default function useMailPageInitialState({
  locationSearch,
  userId,
  defaultAdvancedFilters,
} = {}) {
  return useMemo(
    () => resolveMailPageInitialState({
      locationSearch,
      userId,
      defaultAdvancedFilters,
    }),
    [defaultAdvancedFilters, locationSearch, userId],
  );
}
