import { useCallback } from 'react';

export default function useMailQuickReplyStatusToasts({
  notifyMailInfo,
  notifyMailSuccess,
} = {}) {
  const handleQuickReplySendingStart = useCallback(() => {
    notifyMailInfo('Письмо отправляется…', {
      dedupeKey: 'mail-quick-reply:sending',
      durationMs: 4000,
    });
  }, [notifyMailInfo]);

  const handleQuickReplySent = useCallback(() => {
    notifyMailSuccess('Письмо отправлено.');
  }, [notifyMailSuccess]);

  return {
    handleQuickReplySendingStart,
    handleQuickReplySent,
  };
}
