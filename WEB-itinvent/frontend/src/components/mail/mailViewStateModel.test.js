import { describe, expect, it } from 'vitest';
import {
  MAIL_LIST_VIEW_STATE_STORAGE_KEY,
  MAIL_VIEW_STATE_STORAGE_KEY,
  buildMailRoute,
  buildMailViewStateStorageKey,
  normalizeMailListViewContextState,
  normalizeMailViewState,
  readStoredMailListViewState,
  readStoredMailViewState,
  writeStoredMailListViewState,
  writeStoredMailViewState,
} from './mailViewStateModel';

const createMemoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    dump: () => Object.fromEntries(map.entries()),
  };
};

describe('mailViewStateModel', () => {
  it('normalizes mailbox view state with safe defaults', () => {
    expect(normalizeMailViewState({
      folder: ' Sent ',
      viewMode: 'unknown',
      search: 42,
      unreadOnly: 1,
      advancedFiltersApplied: { folder_scope: 'all' },
    }, {
      defaultAdvancedFilters: { folder_scope: 'current', from: '' },
    })).toEqual({
      folder: 'sent',
      viewMode: 'messages',
      search: '42',
      unreadOnly: true,
      hasAttachmentsOnly: false,
      filterDateFrom: '',
      filterDateTo: '',
      advancedFiltersApplied: { folder_scope: 'all', from: '' },
    });
  });

  it('reads mailbox-specific state before legacy/default fallbacks', () => {
    const storage = createMemoryStorage({
      [buildMailViewStateStorageKey('mb-2')]: JSON.stringify({ folder: 'sent', viewMode: 'conversations' }),
      [MAIL_VIEW_STATE_STORAGE_KEY]: JSON.stringify({ folder: 'inbox' }),
      [buildMailViewStateStorageKey('default')]: JSON.stringify({ folder: 'archive' }),
    });

    expect(readStoredMailViewState('mb-2', { storage })).toMatchObject({
      folder: 'sent',
      viewMode: 'conversations',
    });
    expect(readStoredMailViewState('', { storage })).toMatchObject({
      folder: 'inbox',
      viewMode: 'messages',
    });
  });

  it('writes both mailbox-specific and legacy view state keys', () => {
    const storage = createMemoryStorage();
    writeStoredMailViewState({ folder: 'trash', viewMode: 'conversations' }, { storage, mailboxId: 'mb-1' });

    expect(JSON.parse(storage.dump()[buildMailViewStateStorageKey('mb-1')])).toMatchObject({
      folder: 'trash',
      viewMode: 'conversations',
    });
    expect(JSON.parse(storage.dump()[MAIL_VIEW_STATE_STORAGE_KEY])).toMatchObject({
      folder: 'trash',
      viewMode: 'conversations',
    });
  });

  it('builds canonical mail routes with optional message and mailbox scope', () => {
    expect(buildMailRoute({ folder: ' Sent ', messageId: ' msg-1 ', mailboxId: ' mb-1 ' }))
      .toBe('/mail?folder=sent&message=msg-1&mailbox_id=mb-1');
    expect(buildMailRoute({ folder: '', messageId: '', mailboxId: '' }))
      .toBe('/mail?folder=inbox');
  });

  it('preserves case-sensitive custom folder ids in view state and routes', () => {
    const customFolderId = 'bWFpbGJveDo6QWJjREVfMTIz';

    expect(normalizeMailViewState({ folder: ` ${customFolderId} ` })).toMatchObject({
      folder: customFolderId,
    });
    expect(buildMailRoute({ folder: ` ${customFolderId} ` }))
      .toBe(`/mail?folder=${customFolderId}`);

    const storage = createMemoryStorage();
    writeStoredMailViewState({ folder: customFolderId }, { storage, mailboxId: 'mb-1' });

    expect(readStoredMailViewState('mb-1', { storage })).toMatchObject({
      folder: customFolderId,
    });
  });

  it('normalizes and persists list scroll state per list context', () => {
    expect(normalizeMailListViewContextState({
      scrollTop: -10,
      selectedMessageIdAtOpen: 42,
    })).toEqual({
      scrollTop: 0,
      selectedMessageIdAtOpen: '42',
    });

    const storage = createMemoryStorage({
      [MAIL_LIST_VIEW_STATE_STORAGE_KEY]: JSON.stringify({
        'messages:inbox': { scrollTop: 120, selectedMessageIdAtOpen: 'msg-1' },
        '': { scrollTop: 999 },
      }),
    });
    expect(readStoredMailListViewState({ storage })).toEqual({
      'messages:inbox': { scrollTop: 120, selectedMessageIdAtOpen: 'msg-1' },
    });

    writeStoredMailListViewState({ 'messages:sent': { scrollTop: 20 } }, { storage });
    expect(JSON.parse(storage.dump()[MAIL_LIST_VIEW_STATE_STORAGE_KEY])).toEqual({
      'messages:sent': { scrollTop: 20 },
    });
  });
});
