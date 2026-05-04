import { useCallback, useState } from 'react';
import { toRecipientEmails } from './mailComposeState';
import { normalizeComposeSubject } from './mailComposeSubject';

const getQuickReplyFallbackSender = (message) => {
  const values = [
    message?.sender_email,
    message?.from_email,
    message?.sender?.email,
    message?.from?.email,
    message?.sender,
  ];
  for (const value of values) {
    const recipients = toRecipientEmails([value]);
    if (recipients.length > 0) return recipients;
  }
  return [];
};

export const buildQuickReplyHtml = (body = '') => (
  `<p>${String(body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`
);

export default function useMailQuickReply({
  mailAPI,
  resolveComposeMailboxId,
  invalidateMailClientCache,
  refreshList,
  refreshFolderSummary,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  onError,
} = {}) {
  const [quickReplyBody, setQuickReplyBody] = useState('');
  const [quickReplySending, setQuickReplySending] = useState(false);

  const sendQuickReply = useCallback(async (selectedMessage) => {
    if (!selectedMessage?.id) return false;
    const body = String(quickReplyBody || '').trim();
    if (!body) return false;

    setQuickReplySending(true);
    try {
      const context = selectedMessage?.compose_context?.reply || {};
      const to = toRecipientEmails(context?.to);
      await mailAPI.sendMessage({
        from_mailbox_id: resolveComposeMailboxId(context?.mailbox_id || selectedMessage?.mailbox_id),
        to: to.length > 0 ? to : getQuickReplyFallbackSender(selectedMessage),
        cc: toRecipientEmails(context?.cc),
        bcc: [],
        subject: normalizeComposeSubject('reply', context?.subject || selectedMessage.subject || ''),
        body: buildQuickReplyHtml(quickReplyBody),
        is_html: true,
        reply_to_message_id: selectedMessage.id,
      });
      setQuickReplyBody('');
      invalidateMailClientCache?.();
      await refreshList?.({ silent: true, force: true });
      await refreshFolderSummary?.();
      return true;
    } catch (requestError) {
      const fallback = 'Не удалось отправить быстрый ответ.';
      if (!(await handleMailCredentialsRequired?.(requestError, fallback))) {
        onError?.(getMailErrorDetail?.(requestError, fallback) || fallback);
      }
      return false;
    } finally {
      setQuickReplySending(false);
    }
  }, [
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    quickReplyBody,
    refreshFolderSummary,
    refreshList,
    resolveComposeMailboxId,
    onError,
  ]);

  return {
    quickReplyBody,
    setQuickReplyBody,
    quickReplySending,
    sendQuickReply,
  };
}
