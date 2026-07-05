import {
  countUnreadIncomingAfterMarker,
  getUnreadAnchorId,
} from '../../components/chat/chatHelpers';

export const FIRST_UNREAD_TOP_PADDING = 14;
export const INITIAL_THREAD_POSITION_SETTLE_MS = 1_200;
export const INITIAL_THREAD_POSITION_MAX_MS = 6_000;
export const INITIAL_THREAD_AUTOSCROLL_GUARD_MS = 500;
export const INITIAL_THREAD_SCROLL_TRACE_WINDOW_MS = 200;

export function getInitialScrollMode(conversationId, items = []) {
  const normalizedConversationId = String(conversationId || '').trim();
  if (!normalizedConversationId) return false;
  const conversation = (Array.isArray(items) ? items : []).find(
    (item) => String(item?.id || '').trim() === normalizedConversationId,
  );
  return Number(conversation?.unread_count || 0) > 0 ? 'first_unread_top' : 'bottom_instant';
}

export function resolveInitialAnchorState(items, nextViewerLastReadMessageId, conversation) {
  const unreadAnchorId = getUnreadAnchorId(items, nextViewerLastReadMessageId);
  const hasUnreadCounter = Number(conversation?.unread_count || 0) > 0;
  const derivedUnreadCount = countUnreadIncomingAfterMarker(items, nextViewerLastReadMessageId);
  return {
    mode: unreadAnchorId && (hasUnreadCounter || derivedUnreadCount > 0) ? 'first_unread_top' : 'bottom_instant',
    anchorMessageId: unreadAnchorId,
  };
}

export function resolvePendingAnchorFieldsFromPayload(payload, conversation, derivedAnchor) {
  const apiAnchorMode = String(payload?.initial_anchor_mode || '').trim();
  const apiAnchorMessageId = String(payload?.initial_anchor_message_id || '').trim();
  const mode = apiAnchorMode === 'first_unread'
    ? 'first_unread_top'
    : derivedAnchor.mode;
  const anchorMessageId = mode === 'first_unread_top'
    ? (apiAnchorMessageId || derivedAnchor.anchorMessageId)
    : derivedAnchor.anchorMessageId;
  return { mode, anchorMessageId, source: apiAnchorMode ? 'payload' : 'derived' };
}

export function computePendingInitialAnchorScrollTop({
  pendingAnchor,
  container,
  messages = [],
  viewerLastReadMessageId = '',
}) {
  if (!pendingAnchor || !container) return null;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

  if (pendingAnchor.mode === 'first_unread_top') {
    let anchorMessageId = String(pendingAnchor.anchorMessageId || '').trim();
    if (!pendingAnchor.anchorResolved) {
      if (messages.length === 0) return null;
      anchorMessageId = getUnreadAnchorId(messages, viewerLastReadMessageId);
    }
    if (anchorMessageId) {
      const selector = `[data-chat-message-id="${anchorMessageId}"]`;
      const target = container.querySelector?.(selector);
      if (target) {
        return Math.max(0, target.offsetTop - FIRST_UNREAD_TOP_PADDING);
      }
      return null;
    }
    if (pendingAnchor.anchorResolved) {
      return maxScrollTop;
    }
    return null;
  }

  if (pendingAnchor.mode === 'bottom_instant') {
    return maxScrollTop;
  }

  return null;
}

export function isPendingAnchorScrollUnchanged(previousTarget, currentScrollTop, nextScrollTop) {
  return Number.isFinite(previousTarget)
    && Math.abs(previousTarget - nextScrollTop) < 1
    && Math.abs(currentScrollTop - nextScrollTop) < 1;
}
