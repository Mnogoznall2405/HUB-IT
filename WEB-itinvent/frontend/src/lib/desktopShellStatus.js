export const MAXIMUM_DESKTOP_SHELL_COUNTER = 9999;

export const EMPTY_DESKTOP_SHELL_STATUS = Object.freeze({
  authenticated: false,
  online: false,
  unread_total: 0,
  chat_unread: 0,
  mail_unread: 0,
  tasks_attention: 0,
});

const normalizeCounter = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(
    MAXIMUM_DESKTOP_SHELL_COUNTER,
    Math.max(0, Math.trunc(numeric)),
  );
};

export function buildDesktopShellStatus({
  authenticated = false,
  online = false,
  unreadTotal = 0,
  chatUnread = 0,
  mailUnread = 0,
  tasksAttention = 0,
} = {}) {
  return {
    authenticated: Boolean(authenticated),
    online: Boolean(online),
    unread_total: normalizeCounter(unreadTotal),
    chat_unread: normalizeCounter(chatUnread),
    mail_unread: normalizeCounter(mailUnread),
    tasks_attention: normalizeCounter(tasksAttention),
  };
}
