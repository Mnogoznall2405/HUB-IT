export const normalizeMailboxId = (value) => String(value || '').trim();

export const MAIL_SELECTED_MAILBOX_STORAGE_KEY = 'mail_selected_mailbox_id_v1';

const getDefaultMailboxStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
};

export const readStoredSelectedMailboxId = (
  { storage = getDefaultMailboxStorage() } = {},
) => {
  if (!storage) return '';
  try {
    return normalizeMailboxId(storage.getItem(MAIL_SELECTED_MAILBOX_STORAGE_KEY));
  } catch {
    return '';
  }
};

export const writeStoredSelectedMailboxId = (
  mailboxId = '',
  { storage = getDefaultMailboxStorage() } = {},
) => {
  if (!storage) return;
  const normalizedMailboxId = normalizeMailboxId(mailboxId);
  try {
    if (normalizedMailboxId) {
      storage.setItem(MAIL_SELECTED_MAILBOX_STORAGE_KEY, normalizedMailboxId);
    } else {
      storage.removeItem(MAIL_SELECTED_MAILBOX_STORAGE_KEY);
    }
  } catch {
    // Ignore session storage failures.
  }
};

export const getMailboxEntryId = (value) => normalizeMailboxId(value?.id || value?.mailbox_id);

export const normalizeUnreadCountState = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fresh' || normalized === 'stale') return normalized;
  return 'deferred';
};

export const buildFallbackMailboxEntry = (mailbox) => {
  if (!mailbox || typeof mailbox !== 'object') return null;
  const mailboxId = getMailboxEntryId(mailbox);
  if (!mailboxId) return null;
  return {
    id: mailboxId,
    label: mailbox?.label || mailbox?.mailbox_email || mailbox?.effective_mailbox_login || 'Почтовый ящик',
    mailbox_email: mailbox?.mailbox_email || '',
    mailbox_login: mailbox?.mailbox_login || '',
    effective_mailbox_login: mailbox?.effective_mailbox_login || '',
    auth_mode: mailbox?.auth_mode || mailbox?.mail_auth_mode || 'stored_credentials',
    is_primary: Boolean(mailbox?.is_primary),
    is_active: mailbox?.is_active !== false,
    unread_count: Number(mailbox?.unread_count || 0),
    unread_count_state: normalizeUnreadCountState(mailbox?.unread_count_state || 'deferred'),
    last_selected_at: mailbox?.last_selected_at || null,
    selected: true,
  };
};

export const mergeMailboxEntries = (entries, selectedMailbox = null, existingEntries = []) => {
  const existingById = new Map(
    (Array.isArray(existingEntries) ? existingEntries : [])
      .map((entry) => [getMailboxEntryId(entry), entry])
      .filter(([mailboxId]) => Boolean(mailboxId))
  );
  const result = [];
  const seen = new Set();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const mailboxId = getMailboxEntryId(entry);
    if (!mailboxId || seen.has(mailboxId)) return;
    seen.add(mailboxId);
    const existingEntry = existingById.get(mailboxId) || null;
    const nextUnreadState = normalizeUnreadCountState(entry?.unread_count_state);
    const existingUnreadState = normalizeUnreadCountState(existingEntry?.unread_count_state);
    const preserveFreshUnread = existingUnreadState === 'fresh' && nextUnreadState !== 'fresh';
    result.push({
      ...(existingEntry || {}),
      ...entry,
      id: mailboxId,
      unread_count: preserveFreshUnread
        ? Number(existingEntry?.unread_count || 0)
        : Number((entry?.unread_count ?? existingEntry?.unread_count) || 0),
      unread_count_state: preserveFreshUnread ? existingUnreadState : nextUnreadState,
      is_active: entry?.is_active !== false,
      is_primary: Boolean(entry?.is_primary),
    });
  });
  const fallback = buildFallbackMailboxEntry(selectedMailbox);
  if (fallback && !seen.has(fallback.id)) {
    const existingFallback = existingById.get(fallback.id) || null;
    const existingUnreadState = normalizeUnreadCountState(existingFallback?.unread_count_state);
    const preserveFreshUnread = existingUnreadState === 'fresh'
      && normalizeUnreadCountState(fallback?.unread_count_state) !== 'fresh';
    result.unshift({
      ...(existingFallback || {}),
      ...fallback,
      unread_count: preserveFreshUnread
        ? Number(existingFallback?.unread_count || 0)
        : Number((fallback?.unread_count ?? existingFallback?.unread_count) || 0),
      unread_count_state: preserveFreshUnread
        ? existingUnreadState
        : normalizeUnreadCountState(fallback?.unread_count_state),
    });
  }
  return result;
};

export const withMailboxParams = (activeMailboxId = '', params = {}) => (
  normalizeMailboxId(activeMailboxId)
    ? { ...(params || {}), mailbox_id: normalizeMailboxId(activeMailboxId) }
    : { ...(params || {}) }
);

export const withMailboxPayload = (activeMailboxId = '', payload = {}) => (
  normalizeMailboxId(activeMailboxId)
    ? { ...(payload || {}), mailbox_id: normalizeMailboxId(activeMailboxId) }
    : { ...(payload || {}) }
);

export const resolveItemMailboxId = ({ item = null, activeMailboxId = '' } = {}) => (
  normalizeMailboxId(
    item?.mailbox_id
    || item?.compose_context?.mailbox_id
    || item?.draft_context?.mailbox_id
    || activeMailboxId
  )
);

export const resolveComposeMailboxId = ({
  candidate = '',
  activeMailboxId = '',
  composeFromOptions = [],
} = {}) => {
  const candidateId = typeof candidate === 'object' && candidate !== null
    ? getMailboxEntryId(candidate)
    : '';
  const normalizedCandidate = normalizeMailboxId(candidateId || candidate);
  if (normalizedCandidate) return normalizedCandidate;
  const normalizedActiveMailboxId = normalizeMailboxId(activeMailboxId);
  if (normalizedActiveMailboxId) return normalizedActiveMailboxId;
  return getMailboxEntryId((Array.isArray(composeFromOptions) ? composeFromOptions : [])[0]);
};
