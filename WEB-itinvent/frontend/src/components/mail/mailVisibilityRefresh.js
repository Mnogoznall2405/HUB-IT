export const MAIL_VISIBILITY_REFRESH_COALESCE_MS = 100;

export function createMailVisibilityRefreshScheduler(
  refresh,
  { delayMs = MAIL_VISIBILITY_REFRESH_COALESCE_MS } = {},
) {
  let timerId = 0;

  const schedule = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (timerId) return;
    timerId = window.setTimeout(() => {
      timerId = 0;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void refresh({ reason: 'visibility' });
    }, delayMs);
  };

  const cancel = () => {
    if (!timerId) return;
    window.clearTimeout(timerId);
    timerId = 0;
  };

  return { schedule, cancel };
}
