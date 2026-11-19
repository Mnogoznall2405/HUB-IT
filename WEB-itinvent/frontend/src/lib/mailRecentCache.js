const MAIL_RECENT_CACHE_STORAGE_KEY = 'mail_recent_cache_v3';
// Полные тела писем храним отдельно в sessionStorage: они переживают reload
// вкладки, но не остаются в localStorage после её закрытия.
const MAIL_RECENT_DETAIL_STORAGE_KEY = 'mail_recent_detail_cache_v1';
// Keep last inbox paint long enough that a page refresh does not flash "Нет писем".
const MAIL_RECENT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAIL_RECENT_DETAIL_TTL_MS = 60 * 60 * 1000;
const MAIL_RECENT_CACHE_MAX_CONTEXTS = 4;
const MAIL_RECENT_CACHE_MAX_ITEMS = 50;
const MAIL_RECENT_CACHE_MAX_DETAILS = 20;
const MAIL_RECENT_DETAIL_HTML_MAX_LENGTH = 200_000;
const MAIL_RECENT_DETAIL_TEXT_MAX_LENGTH = 20_000;
// Бюджет на объект с деталями: 20 деталей по 200 КБ в сумме дают ~4 МБ и могут
// упереться в квоту — при переполнении вытесняем старейшие детали.
const MAIL_RECENT_CACHE_MAX_BYTES = 2 * 1024 * 1024;

const nowMs = () => Date.now();

const normalizeScope = (value) => String(value || '').trim();
const normalizeContextKey = (value) => String(value || '').trim();

const safeReadJson = (storage, key) => {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const safeWriteJson = (storage, key, payload) => {
  if (!storage) return;
  try {
    const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
    if (Object.keys(normalizedPayload).length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(normalizedPayload));
  } catch {
    // ignore storage errors
  }
};

const getLocalStore = () => (typeof window === 'undefined' ? null : window.localStorage);
const getSessionStore = () => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const readPersistedPayload = () => {
  const base = safeReadJson(getLocalStore(), MAIL_RECENT_CACHE_STORAGE_KEY);
  const details = safeReadJson(getSessionStore(), MAIL_RECENT_DETAIL_STORAGE_KEY);
  const merged = { ...(base || {}) };
  Object.entries(details || {}).forEach(([scope, scopeEntry]) => {
    merged[scope] = {
      ...(merged[scope] || {}),
      details: (scopeEntry && typeof scopeEntry === 'object' ? scopeEntry.details : null) || {},
    };
  });
  return merged;
};

const writePersistedPayload = (payload) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const base = {};
  const detailStore = {};
  Object.entries(source).forEach(([scope, scopeEntry]) => {
    const entry = scopeEntry && typeof scopeEntry === 'object' ? scopeEntry : {};
    const details = entry.details && typeof entry.details === 'object' ? entry.details : {};
    base[scope] = {
      bootstrap: entry.bootstrap || null,
      lists: entry.lists && typeof entry.lists === 'object' ? entry.lists : {},
    };
    if (Object.keys(details).length > 0) {
      detailStore[scope] = { details };
    }
  });
  safeWriteJson(getLocalStore(), MAIL_RECENT_CACHE_STORAGE_KEY, base);
  safeWriteJson(getSessionStore(), MAIL_RECENT_DETAIL_STORAGE_KEY, enforceByteBudget(detailStore));
};

const isFresh = (updatedAt, ttlMs = MAIL_RECENT_CACHE_TTL_MS) => (
  (nowMs() - Number(updatedAt || 0)) <= ttlMs
);

const sanitizeFolderTree = (value) => (Array.isArray(value) ? value : []);
const sanitizeFolderSummary = (value) => ((value && typeof value === 'object') ? value : {});

const sanitizeListData = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  const sourceItems = Array.isArray(source.items) ? source.items : [];
  const items = sourceItems.slice(0, MAIL_RECENT_CACHE_MAX_ITEMS);
  const hasMore = items.length > 0 && (Boolean(source.has_more) || sourceItems.length > items.length);
  const appendOffset = hasMore ? items.length : null;
  return {
    items,
    total: Number(source.total || items.length || 0),
    offset: 0,
    limit: Number(source.limit || 50),
    has_more: hasMore,
    next_offset: appendOffset,
    append_offset: appendOffset,
    loaded_pages: items.length > 0 ? 1 : 0,
    search_limited: Boolean(source.search_limited),
    searched_window: Number(source.searched_window || 0),
  };
};

const sanitizeAttachment = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: String(source.id || ''),
    download_token: String(source.download_token || ''),
    downloadable: source.downloadable !== false,
    name: String(source.name || ''),
    content_type: String(source.content_type || ''),
    size: Number(source.size || 0),
    content_id: String(source.content_id || ''),
    is_inline: Boolean(source.is_inline),
    inline_src: source.inline_src ? String(source.inline_src) : null,
  };
};

const sanitizeMessageDetail = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: String(source.id || ''),
    exchange_id: String(source.exchange_id || ''),
    folder: String(source.folder || ''),
    subject: String(source.subject || ''),
    sender: String(source.sender || ''),
    to: Array.isArray(source.to) ? source.to.map((item) => String(item || '')).filter(Boolean) : [],
    cc: Array.isArray(source.cc) ? source.cc.map((item) => String(item || '')).filter(Boolean) : [],
    bcc: Array.isArray(source.bcc) ? source.bcc.map((item) => String(item || '')).filter(Boolean) : [],
    received_at: source.received_at || null,
    is_read: Boolean(source.is_read),
    body_html: String(source.body_html || '').slice(0, MAIL_RECENT_DETAIL_HTML_MAX_LENGTH),
    body_text: String(source.body_text || '').slice(0, MAIL_RECENT_DETAIL_TEXT_MAX_LENGTH),
    importance: String(source.importance || 'normal'),
    categories: Array.isArray(source.categories) ? source.categories.map((item) => String(item || '')).filter(Boolean) : [],
    reminder_is_set: Boolean(source.reminder_is_set),
    reminder_due_by: source.reminder_due_by || null,
    internet_message_id: source.internet_message_id ? String(source.internet_message_id) : null,
    conversation_id: String(source.conversation_id || ''),
    restore_hint_folder: source.restore_hint_folder ? String(source.restore_hint_folder) : null,
    attachments: Array.isArray(source.attachments) ? source.attachments.map(sanitizeAttachment) : [],
    compose_context: source.compose_context && typeof source.compose_context === 'object' ? source.compose_context : null,
    draft_context: source.draft_context && typeof source.draft_context === 'object' ? source.draft_context : null,
    has_external_images: Boolean(source.has_external_images),
    can_archive: source.can_archive !== false,
    can_move: source.can_move !== false,
  };
};

const pruneScopeEntry = (entry) => {
  const source = entry && typeof entry === 'object' ? entry : {};
  const bootstrap = source.bootstrap && isFresh(source.bootstrap.updatedAt)
    ? {
        updatedAt: Number(source.bootstrap.updatedAt || 0),
        folderSummary: sanitizeFolderSummary(source.bootstrap.folderSummary),
        folderTree: sanitizeFolderTree(source.bootstrap.folderTree),
      }
    : null;

  const rawLists = source.lists && typeof source.lists === 'object' ? source.lists : {};
  const listEntries = Object.entries(rawLists)
    .map(([contextKey, value]) => {
      const normalizedContextKey = normalizeContextKey(contextKey);
      const updatedAt = Number(value?.updatedAt || 0);
      if (!normalizedContextKey || !isFresh(updatedAt)) return null;
      return [
        normalizedContextKey,
        {
          updatedAt,
          data: sanitizeListData(value?.data),
        },
      ];
    })
    .filter(Boolean)
    .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
    .slice(0, MAIL_RECENT_CACHE_MAX_CONTEXTS);

  const lists = Object.fromEntries(listEntries);
  const rawDetails = source.details && typeof source.details === 'object' ? source.details : {};
  const detailEntries = Object.entries(rawDetails)
    .map(([messageId, value]) => {
      const normalizedMessageId = String(messageId || '').trim();
      const updatedAt = Number(value?.updatedAt || 0);
      if (!normalizedMessageId || !isFresh(updatedAt, MAIL_RECENT_DETAIL_TTL_MS)) return null;
      return [
        normalizedMessageId,
        {
          updatedAt,
          data: sanitizeMessageDetail(value?.data),
        },
      ];
    })
    .filter(Boolean)
    .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
    .slice(0, MAIL_RECENT_CACHE_MAX_DETAILS);

  const details = Object.fromEntries(detailEntries);
  if (!bootstrap && Object.keys(lists).length === 0 && Object.keys(details).length === 0) return null;
  return { bootstrap, lists, details };
};

const enforceByteBudget = (payload) => {
  let totalBytes;
  try {
    totalBytes = JSON.stringify(payload).length;
  } catch {
    return payload;
  }
  if (totalBytes <= MAIL_RECENT_CACHE_MAX_BYTES) return payload;
  const detailRefs = [];
  Object.entries(payload).forEach(([scope, scopeEntry]) => {
    Object.entries(scopeEntry?.details || {}).forEach(([messageId, entry]) => {
      let bytes = 0;
      try { bytes = JSON.stringify(entry).length; } catch { bytes = 0; }
      detailRefs.push({ scope, messageId, updatedAt: Number(entry?.updatedAt || 0), bytes });
    });
  });
  detailRefs.sort((left, right) => left.updatedAt - right.updatedAt);
  const next = {};
  Object.entries(payload).forEach(([scope, scopeEntry]) => {
    next[scope] = { ...scopeEntry, details: { ...(scopeEntry?.details || {}) } };
  });
  for (const ref of detailRefs) {
    if (totalBytes <= MAIL_RECENT_CACHE_MAX_BYTES) break;
    delete next[ref.scope].details[ref.messageId];
    totalBytes -= ref.bytes;
  }
  Object.keys(next).forEach((scope) => {
    const scopeEntry = next[scope];
    if (!scopeEntry?.bootstrap
      && Object.keys(scopeEntry?.lists || {}).length === 0
      && Object.keys(scopeEntry?.details || {}).length === 0) {
      delete next[scope];
    }
  });
  return next;
};

const prunePayload = (payload) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const nextEntries = Object.entries(source)
    .map(([scope, value]) => {
      const normalizedScope = normalizeScope(scope);
      if (!normalizedScope) return null;
      const prunedScope = pruneScopeEntry(value);
      if (!prunedScope) return null;
      return [normalizedScope, prunedScope];
    })
    .filter(Boolean);
  return Object.fromEntries(nextEntries);
};

const mutatePayload = (mutator) => {
  const current = prunePayload(readPersistedPayload());
  const draft = mutator(current) || current;
  const next = prunePayload(draft);
  writePersistedPayload(next);
  return next;
};

export const getMailRecentHydration = ({ scope, contextKey } = {}) => {
  const normalizedScope = normalizeScope(scope);
  const normalizedContextKey = normalizeContextKey(contextKey);
  if (!normalizedScope) return null;
  const payload = prunePayload(readPersistedPayload());
  const scopeEntry = payload[normalizedScope];
  if (!scopeEntry) return null;
  const bootstrap = scopeEntry.bootstrap || null;
  const listSnapshot = normalizedContextKey ? scopeEntry.lists?.[normalizedContextKey] || null : null;
  if (!bootstrap && !listSnapshot) return null;
  return {
    folderSummary: sanitizeFolderSummary(bootstrap?.folderSummary),
    folderTree: sanitizeFolderTree(bootstrap?.folderTree),
    listData: listSnapshot ? sanitizeListData(listSnapshot.data) : null,
    bootstrapUpdatedAt: Number(bootstrap?.updatedAt || 0),
    listUpdatedAt: Number(listSnapshot?.updatedAt || 0),
  };
};

export const writeMailRecentBootstrap = ({ scope, folderSummary, folderTree } = {}) => {
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) return null;
  const updatedAt = nowMs();
  mutatePayload((payload) => ({
    ...payload,
    [normalizedScope]: {
      ...(payload[normalizedScope] || {}),
      bootstrap: {
        updatedAt,
        folderSummary: sanitizeFolderSummary(folderSummary),
        folderTree: sanitizeFolderTree(folderTree),
      },
      lists: {
        ...((payload[normalizedScope] || {}).lists || {}),
      },
    },
  }));
  return updatedAt;
};

export const writeMailRecentList = ({ scope, contextKey, listData } = {}) => {
  const normalizedScope = normalizeScope(scope);
  const normalizedContextKey = normalizeContextKey(contextKey);
  if (!normalizedScope || !normalizedContextKey) return null;
  const updatedAt = nowMs();
  mutatePayload((payload) => ({
    ...payload,
    [normalizedScope]: {
      ...(payload[normalizedScope] || {}),
      bootstrap: (payload[normalizedScope] || {}).bootstrap || null,
      lists: {
        ...((payload[normalizedScope] || {}).lists || {}),
        [normalizedContextKey]: {
          updatedAt,
          data: sanitizeListData(listData),
        },
      },
      details: {
        ...((payload[normalizedScope] || {}).details || {}),
      },
    },
  }));
  return updatedAt;
};

export const getMailRecentMessageDetail = ({ scope, messageId } = {}) => {
  const normalizedScope = normalizeScope(scope);
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedScope || !normalizedMessageId) return null;
  const payload = prunePayload(readPersistedPayload());
  const scopeEntry = payload[normalizedScope];
  if (!scopeEntry) return null;
  const detailEntry = scopeEntry.details?.[normalizedMessageId];
  if (!detailEntry) return null;
  return sanitizeMessageDetail(detailEntry.data);
};

export const writeMailRecentMessageDetail = ({ scope, message } = {}) => {
  const normalizedScope = normalizeScope(scope);
  const normalizedMessageId = String(message?.id || '').trim();
  if (!normalizedScope || !normalizedMessageId) return null;
  const updatedAt = nowMs();
  mutatePayload((payload) => ({
    ...payload,
    [normalizedScope]: {
      ...(payload[normalizedScope] || {}),
      bootstrap: (payload[normalizedScope] || {}).bootstrap || null,
      lists: {
        ...((payload[normalizedScope] || {}).lists || {}),
      },
      details: {
        ...((payload[normalizedScope] || {}).details || {}),
        [normalizedMessageId]: {
          updatedAt,
          data: sanitizeMessageDetail(message),
        },
      },
    },
  }));
  return updatedAt;
};

export const clearMailRecentCacheForScope = (scope) => {
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) return;
  mutatePayload((payload) => {
    const next = { ...(payload || {}) };
    delete next[normalizedScope];
    return next;
  });
};

export const clearAllMailRecentCache = () => {
  writePersistedPayload({});
};

export const __MAIL_RECENT_CACHE_TESTING__ = {
  MAIL_RECENT_CACHE_STORAGE_KEY,
  MAIL_RECENT_DETAIL_STORAGE_KEY,
  MAIL_RECENT_CACHE_TTL_MS,
  MAIL_RECENT_DETAIL_TTL_MS,
  MAIL_RECENT_CACHE_MAX_CONTEXTS,
  MAIL_RECENT_CACHE_MAX_ITEMS,
  MAIL_RECENT_CACHE_MAX_DETAILS,
  MAIL_RECENT_CACHE_MAX_BYTES,
};
