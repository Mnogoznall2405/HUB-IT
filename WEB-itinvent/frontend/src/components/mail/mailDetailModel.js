import {
  buildMailConversationDetailCacheKey,
  buildMailMessageDetailCacheKey,
} from './mailListModel';

export const normalizeMailDetailMode = (value) => (value === 'conversations' ? 'conversations' : 'messages');

export const hasMailDetailBodyContent = (detail) => Boolean(
  String(detail?.body_html || '').trim()
  || String(detail?.body_text || '').trim()
);

export const createSelectedMessagePreviewShell = (item, folder = 'inbox') => {
  if (!item || typeof item !== 'object') return null;
  const messageId = String(item?.id || '').trim();
  if (!messageId) return null;
  const bodyPreview = String(item?.body_preview || '').trim();
  return {
    id: messageId,
    exchange_id: String(item?.exchange_id || ''),
    folder: String(item?.folder || folder || 'inbox'),
    subject: String(item?.subject || ''),
    sender: String(item?.sender || ''),
    sender_person: item?.sender_person || null,
    sender_name: item?.sender_name || '',
    sender_email: item?.sender_email || '',
    sender_display: item?.sender_display || '',
    to: [],
    to_people: [],
    cc: [],
    cc_people: [],
    bcc: [],
    bcc_people: [],
    received_at: item?.received_at || null,
    is_read: Boolean(item?.is_read),
    body_html: '',
    body_text: bodyPreview,
    importance: String(item?.importance || 'normal'),
    categories: Array.isArray(item?.categories) ? item.categories : [],
    reminder_is_set: false,
    reminder_due_by: null,
    internet_message_id: null,
    conversation_id: String(item?.conversation_id || ''),
    restore_hint_folder: null,
    attachments: [],
    compose_context: null,
    draft_context: null,
    has_external_images: false,
    can_archive: String(item?.folder || folder || 'inbox') !== 'archive',
    can_move: true,
    __previewOnly: true,
  };
};

export const mergeMessageDetailPreservingBody = ({
  nextMessage,
  previousMessage,
  hasBodyContent = hasMailDetailBodyContent,
} = {}) => {
  if (!nextMessage || typeof nextMessage !== 'object') return nextMessage;
  if (!previousMessage || typeof previousMessage !== 'object') return nextMessage;
  if (String(nextMessage?.id || '') !== String(previousMessage?.id || '')) return nextMessage;
  if (hasBodyContent(nextMessage) || !hasBodyContent(previousMessage)) return nextMessage;
  return {
    ...nextMessage,
    body_html: previousMessage.body_html || '',
    body_text: previousMessage.body_text || '',
    attachments: Array.isArray(nextMessage.attachments) && nextMessage.attachments.length > 0
      ? nextMessage.attachments
      : (Array.isArray(previousMessage.attachments) ? previousMessage.attachments : []),
  };
};

export const buildMailDetailContextKey = ({
  viewMode = 'messages',
  folder = 'inbox',
  selectedId = '',
} = {}) => `${normalizeMailDetailMode(viewMode)}:${String(folder || '')}:${String(selectedId || '')}`;

export const buildMailDetailCacheKey = ({
  viewMode = 'messages',
  scope = '',
  selectedId = '',
  folder = 'inbox',
  folderScope = 'current',
} = {}) => {
  const normalizedMode = normalizeMailDetailMode(viewMode);
  if (normalizedMode === 'conversations') {
    return buildMailConversationDetailCacheKey({
      scope,
      conversationId: selectedId,
      folder,
      folderScope,
    });
  }
  return buildMailMessageDetailCacheKey({
    scope,
    messageId: selectedId,
  });
};

export const shouldPreferRecentMailMessageDetail = ({
  viewMode = 'messages',
  cachedDetail = null,
  recentDetail = null,
  hasBodyContent = hasMailDetailBodyContent,
} = {}) => {
  if (normalizeMailDetailMode(viewMode) !== 'messages') return false;
  if (!recentDetail) return false;
  const cachedData = cachedDetail?.data || null;
  return !cachedData || (!hasBodyContent(cachedData) && hasBodyContent(recentDetail));
};

export const shouldForceMailDetailFetch = ({
  force = false,
  cachedDetail = null,
} = {}) => Boolean(force || cachedDetail?.data);

export const resolveMailDetailInitialState = ({
  viewMode = 'messages',
  cachedDetail = null,
  recentDetail = null,
  shouldShowSkeleton = false,
  detailContextKey = '',
  suppressAutoReadKey = '',
  hasBodyContent = hasMailDetailBodyContent,
} = {}) => {
  const preferRecentDetail = shouldPreferRecentMailMessageDetail({
    viewMode,
    cachedDetail,
    recentDetail,
    hasBodyContent,
  });
  const suppressAutoRead = Boolean(
    detailContextKey
    && suppressAutoReadKey
    && String(suppressAutoReadKey) === String(detailContextKey)
  );
  const withDetail = (detail, source) => ({
    detail,
    source,
    shouldShowLoading: false,
    suppressAutoRead,
    nextSuppressAutoReadKey: suppressAutoRead ? '' : suppressAutoReadKey,
  });

  if (cachedDetail?.data && !preferRecentDetail) {
    return withDetail(cachedDetail.data, 'cache');
  }
  if (recentDetail) {
    return withDetail(recentDetail, 'recent');
  }
  return {
    detail: null,
    source: 'none',
    shouldShowLoading: Boolean(shouldShowSkeleton),
    suppressAutoRead: false,
    nextSuppressAutoReadKey: suppressAutoReadKey,
  };
};

export const resolveMailDetailLoadErrorAction = ({
  viewMode = 'messages',
  requestError = null,
  errorDetail = '',
  hasStableSelectedMessageBody = false,
  isMissingDetailError = () => false,
  isTransientRequestError = () => false,
} = {}) => {
  const normalizedMode = normalizeMailDetailMode(viewMode);
  const statusCode = Number(requestError?.response?.status || 0);

  if (normalizedMode === 'conversations' && statusCode === 404) {
    return { type: 'clear-conversation-selection' };
  }

  if (
    normalizedMode === 'messages'
    && isMissingDetailError(requestError, errorDetail)
  ) {
    return {
      type: 'clear-missing-message-selection',
      userMessage: 'Выбранное письмо больше недоступно. Список обновлен.',
    };
  }

  if (
    normalizedMode === 'messages'
    && hasStableSelectedMessageBody
    && isTransientRequestError(requestError)
  ) {
    return { type: 'suppress-transient-error' };
  }

  return {
    type: 'show-error',
    errorDetail: String(errorDetail || ''),
  };
};
