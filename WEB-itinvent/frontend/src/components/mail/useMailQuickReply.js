import { useCallback, useRef, useState } from 'react';
import { toRecipientEmails } from './mailComposeState';
import { normalizeComposeSubject } from './mailComposeSubject';
import {
  buildQuickReplyHtml,
  buildQuickReplyOutgoingHtml,
  resolveMailReplyQuoteHtml,
} from './mailQuickReplyBody';
import { createMailSendIdempotencyKey } from './mailSendIdempotency';
import { getMailSendErrorMessage } from './mailSendOutcome';

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

export { buildQuickReplyHtml };

export default function useMailQuickReply({
  mailAPI,
  resolveComposeMailboxId,
  invalidateMailClientCache,
  refreshList,
  refreshFolderSummary,
  handleMailCredentialsRequired,
  onError,
  onSendingStart,
  onSent,
} = {}) {
  const [quickReplySending, setQuickReplySending] = useState(false);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const sendingLockRef = useRef(false);
  const idempotencyKeyRef = useRef('');

  const sendQuickReply = useCallback(async (selectedMessage, body, { mode = 'reply' } = {}) => {
    if (!selectedMessage?.id) return false;
    if (!body?.trim()) return false;
    if (sendingLockRef.current) return false;
    sendingLockRef.current = true;
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createMailSendIdempotencyKey();
    }
    const normalizedBody = String(body).trim();

    setQuickReplySending(true);
    onSendingStart?.();
    try {
      const contextKey = mode === 'reply_all' ? 'reply_all' : 'reply';
      const context = selectedMessage?.compose_context?.[contextKey]
        || selectedMessage?.compose_context?.reply
        || {};
      const to = toRecipientEmails(context?.to);
      await mailAPI.sendMessage({
        from_mailbox_id: resolveComposeMailboxId(context?.mailbox_id || selectedMessage?.mailbox_id),
        to: to.length > 0 ? to : getQuickReplyFallbackSender(selectedMessage),
        cc: toRecipientEmails(context?.cc),
        bcc: [],
        subject: normalizeComposeSubject('reply', context?.subject || selectedMessage.subject || ''),
        body: buildQuickReplyOutgoingHtml(
          normalizedBody,
          resolveMailReplyQuoteHtml(selectedMessage, context),
        ),
        is_html: true,
        reply_to_message_id: selectedMessage.id,
        idempotencyKey: idempotencyKeyRef.current,
      });
      idempotencyKeyRef.current = '';
      setDraftEpoch((value) => value + 1);
      invalidateMailClientCache?.();
      await refreshList?.({ silent: true, force: true });
      await refreshFolderSummary?.();
      onSent?.();
      return true;
    } catch (requestError) {
      const fallback = 'Не удалось отправить быстрый ответ.';
      if (!(await handleMailCredentialsRequired?.(requestError, fallback))) {
        onError?.(getMailSendErrorMessage(requestError, fallback));
      }
      return false;
    } finally {
      sendingLockRef.current = false;
      setQuickReplySending(false);
    }
  }, [
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    refreshFolderSummary,
    refreshList,
    resolveComposeMailboxId,
    onError,
    onSendingStart,
    onSent,
  ]);

  return {
    draftEpoch,
    quickReplySending,
    sendQuickReply,
  };
}
