export function emitChatUnreadRefresh() {
  window.dispatchEvent(new CustomEvent('chat-unread-needs-refresh'));
  window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
}
