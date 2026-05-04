import { normalizeMailListResponse } from './mailListModel';

const normalizeMailViewMode = (value) => (value === 'conversations' ? 'conversations' : 'messages');

const normalizeTargetId = (targetId) => String(targetId || '').trim();

const normalizeOverrides = (overrides) => (
  overrides instanceof Map ? overrides : new Map()
);

export const getReadStateOverrideKey = ({ mode, targetId } = {}) => {
  const normalizedTargetId = normalizeTargetId(targetId);
  return normalizedTargetId ? `${normalizeMailViewMode(mode)}:${normalizedTargetId}` : '';
};

export const getConversationReadUnreadCount = ({
  isRead,
  unreadCount = 0,
  messageCount = 0,
} = {}) => (
  Boolean(isRead)
    ? 0
    : Math.max(1, Number(messageCount || 0), Number(unreadCount || 0))
);

export const buildMailReadMutationPlan = ({
  mode,
  targetId,
  nextIsRead,
  currentUnreadCount = 0,
  currentMessageCount = 1,
} = {}) => {
  const normalizedMode = normalizeMailViewMode(mode);
  const normalizedTargetId = normalizeTargetId(targetId);
  if (!normalizedTargetId) return null;
  const normalizedUnreadCount = Math.max(0, Number(currentUnreadCount || 0));
  const normalizedMessageCount = Math.max(1, Number(currentMessageCount || 1));
  const unreadDelta = normalizedMode === 'conversations'
    ? (nextIsRead ? -normalizedUnreadCount : Math.max(0, normalizedMessageCount - normalizedUnreadCount))
    : (nextIsRead ? (normalizedUnreadCount > 0 ? -1 : 0) : (normalizedUnreadCount > 0 ? 0 : 1));

  return {
    normalizedMode,
    normalizedTargetId,
    normalizedUnreadCount,
    normalizedMessageCount,
    nextIsRead: Boolean(nextIsRead),
    unreadDelta,
  };
};

export const pruneLocalReadStateOverrides = ({
  overrides,
  now = Date.now(),
  ttlMs,
} = {}) => {
  const normalizedNow = Number(now || 0);
  const normalizedTtlMs = Number(ttlMs);
  if (!Number.isFinite(normalizedTtlMs)) {
    return new Map(normalizeOverrides(overrides));
  }
  const nextOverrides = new Map();

  for (const [key, entry] of normalizeOverrides(overrides).entries()) {
    if ((normalizedNow - Number(entry?.updatedAt || 0)) < Math.max(0, normalizedTtlMs)) {
      nextOverrides.set(key, entry);
    }
  }

  return nextOverrides;
};

export const setLocalReadStateOverride = ({
  mode,
  targetId,
  isRead,
  overrides,
  now = Date.now(),
  ttlMs,
} = {}) => {
  const key = getReadStateOverrideKey({ mode, targetId });
  if (!key) return new Map(normalizeOverrides(overrides));

  const nextOverrides = pruneLocalReadStateOverrides({ overrides, now, ttlMs });
  nextOverrides.set(key, {
    isRead: Boolean(isRead),
    updatedAt: Number(now || 0),
  });
  return nextOverrides;
};

export const clearLocalReadStateOverride = ({
  mode,
  targetId,
  overrides,
} = {}) => {
  const key = getReadStateOverrideKey({ mode, targetId });
  const nextOverrides = new Map(normalizeOverrides(overrides));
  if (key) nextOverrides.delete(key);
  return nextOverrides;
};

export const getLocalReadStateOverride = ({
  mode,
  targetId,
  overrides,
} = {}) => {
  const key = getReadStateOverrideKey({ mode, targetId });
  if (!key) return null;
  const entry = normalizeOverrides(overrides).get(key);
  return entry ? Boolean(entry.isRead) : null;
};

export const applyReadStateOverridesToListData = ({
  listData,
  selectionMode = 'messages',
  overrides,
} = {}) => {
  const normalized = normalizeMailListResponse(listData);
  const normalizedMode = normalizeMailViewMode(selectionMode);
  const items = (Array.isArray(normalized.items) ? normalized.items : []).map((item) => {
    if (normalizedMode === 'conversations') {
      const conversationId = normalizeTargetId(item?.conversation_id || item?.id);
      const override = getLocalReadStateOverride({
        mode: 'conversations',
        targetId: conversationId,
        overrides,
      });
      if (override === null) return item;
      return {
        ...item,
        unread_count: override ? 0 : Math.max(1, Number(item?.unread_count || 0)),
      };
    }

    const messageId = normalizeTargetId(item?.id);
    const override = getLocalReadStateOverride({
      mode: 'messages',
      targetId: messageId,
      overrides,
    });
    return override === null ? item : { ...item, is_read: override };
  });

  return {
    ...normalized,
    items,
  };
};

export const applyReadStateOverridesToMessageDetail = ({
  message,
  overrides,
} = {}) => {
  if (!message || typeof message !== 'object') return message;
  const messageId = normalizeTargetId(message?.id);
  const override = getLocalReadStateOverride({
    mode: 'messages',
    targetId: messageId,
    overrides,
  });
  return override === null ? message : { ...message, is_read: override };
};

export const applyReadStateOverridesToConversationDetail = ({
  conversation,
  overrides,
} = {}) => {
  if (!conversation || typeof conversation !== 'object') return conversation;
  const conversationId = normalizeTargetId(conversation?.conversation_id || conversation?.id);
  const override = getLocalReadStateOverride({
    mode: 'conversations',
    targetId: conversationId,
    overrides,
  });
  if (override === null) return conversation;
  return {
    ...conversation,
    unread_count: override ? 0 : Math.max(1, Number(conversation?.unread_count || 0)),
    items: (Array.isArray(conversation?.items) ? conversation.items : []).map((item) => ({
      ...item,
      is_read: override,
    })),
  };
};
