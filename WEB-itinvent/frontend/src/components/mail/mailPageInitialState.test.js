import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_ADVANCED_FILTERS } from './useMailAdvancedSearch';
import { MAIL_SELECTED_MAILBOX_STORAGE_KEY } from './mailMailboxModel';
import { buildMailViewStateStorageKey } from './mailViewStateModel';
import { resolveMailPageInitialState } from './mailPageInitialState';

const createStorage = (entries = {}) => ({
  getItem: (key) => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null),
});

describe('resolveMailPageInitialState', () => {
  it('prefers mailbox_id from the route and ignores stored mailbox id', () => {
    const selectedMailboxStorage = createStorage({
      [MAIL_SELECTED_MAILBOX_STORAGE_KEY]: 'stored-mb',
    });
    const getRecentHydration = vi.fn(() => ({ folderSummary: { inbox: { unread: 2 } } }));

    const result = resolveMailPageInitialState({
      locationSearch: '?mailbox_id=route-mb&folder=inbox',
      userId: 'user-9',
      defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS,
      selectedMailboxStorage,
      viewStateStorage: createStorage(),
      getRecentHydration,
    });

    expect(result.initialRouteMailboxId).toBe('route-mb');
    expect(result.initialSelectedMailboxId).toBe('route-mb');
    expect(result.initialMailCacheScope).toBe('route-mb');
    expect(getRecentHydration).toHaveBeenCalledWith({
      scope: 'route-mb',
      contextKey: expect.any(String),
    });
    expect(result.initialMailRecentHydration).toEqual({ folderSummary: { inbox: { unread: 2 } } });
  });

  it('falls back to the stored mailbox and its view state when the route has no mailbox', () => {
    const selectedMailboxStorage = createStorage({
      [MAIL_SELECTED_MAILBOX_STORAGE_KEY]: 'stored-mb',
    });
    const viewStateStorage = createStorage({
      [buildMailViewStateStorageKey('stored-mb')]: JSON.stringify({
        folder: 'sent',
        viewMode: 'conversations',
        search: 'invoice',
        unreadOnly: true,
        hasAttachmentsOnly: false,
        filterDateFrom: '',
        filterDateTo: '',
        advancedFiltersApplied: { ...DEFAULT_ADVANCED_FILTERS, from_filter: 'a@b.c' },
      }),
    });

    const result = resolveMailPageInitialState({
      locationSearch: '',
      userId: 'user-9',
      defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS,
      selectedMailboxStorage,
      viewStateStorage,
      getRecentHydration: vi.fn(() => null),
    });

    expect(result.initialRouteMailboxId).toBe('');
    expect(result.initialSelectedMailboxId).toBe('stored-mb');
    expect(result.initialMailViewState).toMatchObject({
      folder: 'sent',
      viewMode: 'conversations',
      search: 'invoice',
      unreadOnly: true,
    });
    expect(result.initialMailViewState.advancedFiltersApplied.from_filter).toBe('a@b.c');
    expect(result.initialMailCacheScope).toBe('stored-mb');
  });

  it('uses the user id as cache scope when no mailbox is selected yet', () => {
    const result = resolveMailPageInitialState({
      locationSearch: '',
      userId: 'user-9',
      defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS,
      selectedMailboxStorage: createStorage(),
      viewStateStorage: createStorage(),
      getRecentHydration: vi.fn(() => null),
    });

    expect(result.initialSelectedMailboxId).toBe('');
    expect(result.initialMailCacheScope).toBe('user-9');
    expect(result.initialMailViewState.folder).toBe('inbox');
  });
});
