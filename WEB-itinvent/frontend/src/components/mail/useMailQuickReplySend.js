import { useCallback } from 'react';

import { getMailSelectedReplyMode } from './mailReplyIntent';

export default function useMailQuickReplySend({
  selectedMessage,
  mailboxEmails,
  selectedConversation,
  viewMode,
  sendQuickReply,
} = {}) {
  return useCallback(async (body) => {
    if (!selectedMessage?.id) return;
    const replyMode = getMailSelectedReplyMode({
      message: selectedMessage,
      mailboxEmails,
      selectedConversation,
      viewMode,
    });
    await sendQuickReply(selectedMessage, body, { mode: replyMode });
  }, [mailboxEmails, selectedConversation, selectedMessage, sendQuickReply, viewMode]);
}
