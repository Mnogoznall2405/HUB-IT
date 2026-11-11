import { useCallback } from 'react';

export default function useMailNotifications({
  notifySuccess,
  notifyInfo,
  notifyWarning,
} = {}) {
  const notifyMailSuccess = useCallback((value, options = {}) => {
    const text = String(value || '').trim();
    if (!text) return;
    notifySuccess(text, { source: 'mail', dedupeMode: 'none', ...options });
  }, [notifySuccess]);

  const notifyMailInfo = useCallback((value, options = {}) => {
    const text = String(value || '').trim();
    if (!text) return;
    notifyInfo(text, { source: 'mail', dedupeMode: 'recent', ...options });
  }, [notifyInfo]);

  const notifyMailComposeWarning = useCallback((warning) => {
    const message = String(warning?.message || '').trim();
    if (!message) return;
    const severity = String(warning?.severity || 'warning');
    const notify = severity === 'info' ? notifyInfo : notifyWarning;
    notify(message, {
      source: warning?.source || 'mail-compose',
      title: String(warning?.title || (severity === 'info' ? 'Информация' : 'Предупреждение')).trim(),
      dedupeMode: 'recent',
      dedupeKey: warning?.dedupeKey || `mail-compose:${String(warning?.id || message)}`,
      durationMs: Number(warning?.durationMs || 4500),
    });
  }, [notifyInfo, notifyWarning]);

  return {
    notifyMailSuccess,
    notifyMailInfo,
    notifyMailComposeWarning,
  };
}
