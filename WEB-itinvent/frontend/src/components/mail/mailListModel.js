const DEFAULT_MAIL_BOOTSTRAP_LIMIT = 20;
const DEFAULT_MAIL_LIST_LIMIT = 50;

const normalizeMailViewMode = (value) => (value === 'conversations' ? 'conversations' : 'messages');
const normalizeMailFolder = (value) => String(value || 'inbox').trim().toLowerCase() || 'inbox';

export const createEmptyListData = () => ({
  items: [],
  total: 0,
  offset: 0,
  limit: DEFAULT_MAIL_LIST_LIMIT,
  has_more: false,
  next_offset: null,
  append_offset: null,
  loaded_pages: 0,
  search_limited: false,
  searched_window: 0,
});

export const buildMailBootstrapCacheKey = ({ scope, limit = DEFAULT_MAIL_BOOTSTRAP_LIMIT }) => [
  'mail',
  scope,
  'bootstrap',
  Number(limit || DEFAULT_MAIL_BOOTSTRAP_LIMIT),
];

export const buildMailFolderSummaryCacheKey = ({ scope }) => ['mail', scope, 'folder-summary'];

export const buildMailFolderTreeCacheKey = ({ scope }) => ['mail', scope, 'folder-tree'];

export const buildMailListCacheKey = ({
  scope,
  folder,
  viewMode,
  q,
  unreadOnly,
  hasAttachmentsOnly,
  dateFrom,
  dateTo,
  folderScope,
  fromFilter,
  toFilter,
  subjectFilter,
  bodyFilter,
  importance,
  limit,
  offset,
}) => [
  'mail',
  scope,
  'list',
  normalizeMailViewMode(viewMode),
  normalizeMailFolder(folder),
  String(q || ''),
  unreadOnly ? 1 : 0,
  hasAttachmentsOnly ? 1 : 0,
  String(dateFrom || ''),
  String(dateTo || ''),
  String(folderScope || 'current'),
  String(fromFilter || ''),
  String(toFilter || ''),
  String(subjectFilter || ''),
  String(bodyFilter || ''),
  String(importance || ''),
  Number(limit || DEFAULT_MAIL_LIST_LIMIT),
  Number(offset || 0),
];

export const buildMailListRequestContext = ({
  scope = '',
  folder = 'inbox',
  viewMode = 'messages',
  search,
  q,
  unreadOnly = false,
  hasAttachmentsOnly = false,
  dateFrom = '',
  dateTo = '',
  advancedFilters = {},
  limit = DEFAULT_MAIL_LIST_LIMIT,
  offset = 0,
} = {}) => {
  const normalizedFolder = normalizeMailFolder(folder);
  const normalizedMode = normalizeMailViewMode(viewMode);
  const query = String(search ?? q ?? '');
  const folderScope = String(advancedFilters?.folder_scope || 'current');
  const fromFilter = advancedFilters?.from_filter || '';
  const toFilter = advancedFilters?.to_filter || '';
  const subjectFilter = advancedFilters?.subject_filter || '';
  const bodyFilter = advancedFilters?.body_filter || '';
  const importance = advancedFilters?.importance || '';
  const normalizedLimit = Number(limit || DEFAULT_MAIL_LIST_LIMIT);
  const normalizedOffset = Number(offset || 0);
  const params = {
    folder: normalizedFolder,
    q: query || undefined,
    unread_only: unreadOnly || undefined,
    has_attachments: hasAttachmentsOnly || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    folder_scope: folderScope || undefined,
    from_filter: fromFilter || undefined,
    to_filter: toFilter || undefined,
    subject_filter: subjectFilter || undefined,
    body_filter: bodyFilter || undefined,
    importance: importance || undefined,
    limit: normalizedLimit,
    offset: normalizedOffset,
  };
  const cacheKey = buildMailListCacheKey({
    scope,
    folder: normalizedFolder,
    viewMode: normalizedMode,
    q: query,
    unreadOnly,
    hasAttachmentsOnly,
    dateFrom,
    dateTo,
    folderScope,
    fromFilter,
    toFilter,
    subjectFilter,
    bodyFilter,
    importance,
    limit: normalizedLimit,
    offset: normalizedOffset,
  });
  return {
    folder: normalizedFolder,
    viewMode: normalizedMode,
    query,
    folderScope,
    params,
    cacheKey,
    contextKey: JSON.stringify(cacheKey),
    usesBootstrapList: normalizedFolder === 'inbox'
      && normalizedMode === 'messages'
      && !query
      && !unreadOnly
      && !hasAttachmentsOnly
      && !dateFrom
      && !dateTo
      && !fromFilter
      && !toFilter
      && !subjectFilter
      && !bodyFilter
      && !importance
      && folderScope === 'current',
  };
};

export const buildMailMessageDetailCacheKey = ({ scope, messageId }) => [
  'mail',
  scope,
  'message-detail',
  String(messageId || ''),
];

export const buildMailConversationDetailCacheKey = ({ scope, conversationId, folder, folderScope }) => [
  'mail',
  scope,
  'conversation-detail',
  String(conversationId || ''),
  String(folder || 'inbox').trim().toLowerCase() || 'inbox',
  String(folderScope || 'current'),
];

export const normalizeMailListResponse = (payload = {}, fallbackItems = []) => ({
  items: Array.isArray(payload?.items) ? payload.items : fallbackItems,
  total: Number(payload?.total || fallbackItems.length || 0),
  offset: Number(payload?.offset || 0),
  limit: Number(payload?.limit || DEFAULT_MAIL_LIST_LIMIT),
  has_more: Boolean(payload?.has_more),
  next_offset: payload?.next_offset ?? null,
  append_offset: payload?.append_offset ?? payload?.next_offset ?? null,
  loaded_pages: Math.max(
    0,
    Number(
      payload?.loaded_pages
      || ((Array.isArray(payload?.items) ? payload.items.length : fallbackItems.length) > 0 ? 1 : 0)
    )
  ),
  search_limited: Boolean(payload?.search_limited),
  searched_window: Number(payload?.searched_window || 0),
});

export const isExpandedMailListData = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  const itemsCount = Array.isArray(source.items) ? source.items.length : 0;
  const limit = Math.max(1, Number(source.limit || DEFAULT_MAIL_LIST_LIMIT));
  return Number(source.loaded_pages || 0) > 1 || itemsCount > limit;
};

const getMailListItemKey = (item, viewMode = 'messages') => String(
  viewMode === 'conversations'
    ? (item?.conversation_id || item?.id || '')
    : (item?.id || '')
).trim();

const dedupeMailListItems = (items = [], viewMode = 'messages') => {
  const result = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = getMailListItemKey(item, viewMode);
    if (!key) {
      result.push(item);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
};

export const buildMailListState = ({
  previousListData,
  nextListData,
  updateMode = 'replace',
  selectionMode = 'messages',
} = {}) => {
  const previous = normalizeMailListResponse(
    previousListData,
    Array.isArray(previousListData?.items) ? previousListData.items : []
  );
  const incoming = normalizeMailListResponse(
    nextListData,
    Array.isArray(nextListData?.items) ? nextListData.items : []
  );
  const limit = Math.max(1, Number(incoming.limit || previous.limit || DEFAULT_MAIL_LIST_LIMIT));

  if (updateMode === 'append') {
    const items = dedupeMailListItems([...(previous.items || []), ...(incoming.items || [])], selectionMode);
    const total = Math.max(Number(incoming.total || previous.total || items.length), items.length);
    const loadedPages = Math.max(
      Number(previous.loaded_pages || 0) + 1,
      items.length > 0 ? Math.ceil(items.length / limit) : 0
    );
    const nextAppendOffset = incoming.append_offset ?? incoming.next_offset ?? previous.append_offset ?? previous.next_offset ?? null;
    const hasMore = total > items.length && nextAppendOffset !== null;
    return normalizeMailListResponse({
      ...incoming,
      items,
      total,
      offset: 0,
      has_more: hasMore,
      next_offset: incoming.next_offset ?? null,
      append_offset: hasMore ? nextAppendOffset : null,
      loaded_pages: loadedPages,
    }, items);
  }

  if (updateMode === 'head-merge') {
    const total = Math.max(0, Number(incoming.total || previous.total || 0));
    const mergedItems = dedupeMailListItems([...(incoming.items || []), ...(previous.items || [])], selectionMode);
    const items = total > 0 && mergedItems.length > total ? mergedItems.slice(0, total) : mergedItems;
    const loadedPages = Math.max(
      Number(previous.loaded_pages || 0),
      items.length > 0 ? Math.ceil(items.length / limit) : 0
    );
    const nextAppendOffset = previous.append_offset ?? previous.next_offset ?? incoming.append_offset ?? incoming.next_offset ?? null;
    const hasMore = Math.max(total, items.length) > items.length && nextAppendOffset !== null;
    return normalizeMailListResponse({
      ...incoming,
      items,
      total: Math.max(total, items.length),
      offset: 0,
      has_more: hasMore,
      next_offset: incoming.next_offset ?? null,
      append_offset: hasMore ? nextAppendOffset : null,
      loaded_pages: loadedPages,
    }, items);
  }

  return normalizeMailListResponse(nextListData, Array.isArray(nextListData?.items) ? nextListData.items : []);
};

export const isListItemSame = (left, right, mode) => {
  if (mode === 'conversations') {
    return (
      String(left?.conversation_id || left?.id || '') === String(right?.conversation_id || right?.id || '')
      && Number(left?.unread_count || 0) === Number(right?.unread_count || 0)
      && Number(left?.messages_count || 0) === Number(right?.messages_count || 0)
      && String(left?.last_received_at || '') === String(right?.last_received_at || '')
      && Boolean(left?.has_attachments) === Boolean(right?.has_attachments)
      && String(left?.preview || '') === String(right?.preview || '')
    );
  }
  return (
    String(left?.id || '') === String(right?.id || '')
    && Boolean(left?.is_read) === Boolean(right?.is_read)
    && String(left?.received_at || '') === String(right?.received_at || '')
    && Boolean(left?.has_attachments) === Boolean(right?.has_attachments)
    && String(left?.subject || '') === String(right?.subject || '')
    && String(left?.body_preview || '') === String(right?.body_preview || '')
  );
};
