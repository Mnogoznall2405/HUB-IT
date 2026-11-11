let _pendingTimer = null;
let _pending = false;

/**
 * Trailing-coalesce hub/unread refresh.
 * Multiple mark_read bursts collapse into one trailing emit so hub is not stampeded.
 */
export function emitChatUnreadRefresh() {
  _pending = true;
  if (_pendingTimer != null) return;
  _pendingTimer = window.setTimeout(() => {
    _pendingTimer = null;
    if (!_pending) return;
    _pending = false;
    window.dispatchEvent(new CustomEvent('chat-unread-needs-refresh'));
    window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
  }, 2000);
}

/** Test helper: flush pending coalesce immediately. */
export function flushChatUnreadRefreshForTests() {
  if (_pendingTimer != null) {
    window.clearTimeout(_pendingTimer);
    _pendingTimer = null;
  }
  if (!_pending) return;
  _pending = false;
  window.dispatchEvent(new CustomEvent('chat-unread-needs-refresh'));
  window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
}
