export const MAIL_VIEW_STATE_STORAGE_KEY = 'mail_view_state_v1';
export const MAIL_LIST_VIEW_STATE_STORAGE_KEY = 'mail_list_view_state_v1';

const STANDARD_FOLDER_KEYS = new Set([
  'inbox',
  'sent',
  'sentitems',
  'drafts',
  'trash',
  'deleted',
  'junk',
  'spam',
  'archive',
]);

export const normalizeMailViewMode = (value) => (value === 'conversations' ? 'conversations' : 'messages');

export const normalizeMailFolderId = (value, fallback = 'inbox') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;
  const lowered = trimmed.toLowerCase();
  return STANDARD_FOLDER_KEYS.has(lowered) ? lowered : trimmed;
};

export const normalizeMailViewState = (value = {}, { defaultAdvancedFilters = {} } = {}) => ({
  folder: normalizeMailFolderId(value?.folder),
  viewMode: normalizeMailViewMode(value?.viewMode),
  search: String(value?.search || ''),
  unreadOnly: Boolean(value?.unreadOnly),
  hasAttachmentsOnly: Boolean(value?.hasAttachmentsOnly),
  filterDateFrom: String(value?.filterDateFrom || ''),
  filterDateTo: String(value?.filterDateTo || ''),
  advancedFiltersApplied: {
    ...defaultAdvancedFilters,
    ...((value?.advancedFiltersApplied && typeof value.advancedFiltersApplied === 'object')
      ? value.advancedFiltersApplied
      : {}),
  },
});

const normalizeMailboxId = (value) => String(value || '').trim();

export const buildMailViewStateStorageKey = (mailboxId = '') => (
  `${MAIL_VIEW_STATE_STORAGE_KEY}:${normalizeMailboxId(mailboxId) || 'default'}`
);

export const buildMailRoute = ({ folder = 'inbox', messageId = '', mailboxId = '' } = {}) => {
  const params = new URLSearchParams();
  params.set('folder', normalizeMailFolderId(folder));
  const normalizedMessageId = String(messageId || '').trim();
  const normalizedMailboxId = normalizeMailboxId(mailboxId);
  if (normalizedMessageId) params.set('message', normalizedMessageId);
  if (normalizedMailboxId) params.set('mailbox_id', normalizedMailboxId);
  return `/mail?${params.toString()}`;
};

export const readStoredMailViewState = (
  mailboxId = '',
  { storage = typeof window !== 'undefined' ? window.sessionStorage : null, defaultAdvancedFilters = {} } = {},
) => {
  const fallback = normalizeMailViewState({}, { defaultAdvancedFilters });
  if (!storage) return fallback;
  const normalizedMailboxId = normalizeMailboxId(mailboxId);
  const candidateKeys = normalizedMailboxId
    ? [
        buildMailViewStateStorageKey(normalizedMailboxId),
        MAIL_VIEW_STATE_STORAGE_KEY,
        buildMailViewStateStorageKey('default'),
      ]
    : [
        MAIL_VIEW_STATE_STORAGE_KEY,
        buildMailViewStateStorageKey('default'),
      ];
  try {
    for (const storageKey of candidateKeys) {
      const raw = storage.getItem(storageKey);
      if (!raw) continue;
      return normalizeMailViewState(JSON.parse(raw), { defaultAdvancedFilters });
    }
    return fallback;
  } catch {
    return fallback;
  }
};

export const writeStoredMailViewState = (
  state = {},
  { storage = typeof window !== 'undefined' ? window.sessionStorage : null, mailboxId = '', defaultAdvancedFilters = {} } = {},
) => {
  if (!storage) return;
  const nextState = normalizeMailViewState(state, { defaultAdvancedFilters });
  const serialized = JSON.stringify(nextState);
  const normalizedMailboxId = normalizeMailboxId(mailboxId);
  try {
    if (normalizedMailboxId) {
      storage.setItem(buildMailViewStateStorageKey(normalizedMailboxId), serialized);
    }
    storage.setItem(MAIL_VIEW_STATE_STORAGE_KEY, serialized);
  } catch {
    // Ignore session storage failures.
  }
};

export const normalizeMailListViewContextState = (value) => ({
  scrollTop: Math.max(0, Number(value?.scrollTop || 0)),
  selectedMessageIdAtOpen: String(value?.selectedMessageIdAtOpen || ''),
});

export const readStoredMailListViewState = (
  { storage = typeof window !== 'undefined' ? window.sessionStorage : null } = {},
) => {
  if (!storage) return {};
  try {
    const raw = storage.getItem(MAIL_LIST_VIEW_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.entries(parsed).reduce((acc, [key, value]) => {
      const normalizedKey = String(key || '');
      if (!normalizedKey) return acc;
      acc[normalizedKey] = normalizeMailListViewContextState(value);
      return acc;
    }, {});
  } catch {
    return {};
  }
};

export const writeStoredMailListViewState = (
  state = {},
  { storage = typeof window !== 'undefined' ? window.sessionStorage : null } = {},
) => {
  if (!storage) return;
  try {
    storage.setItem(MAIL_LIST_VIEW_STATE_STORAGE_KEY, JSON.stringify(state && typeof state === 'object' ? state : {}));
  } catch {
    // Ignore session storage failures.
  }
};
